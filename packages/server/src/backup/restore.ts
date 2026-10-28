import { mkdir, readFile, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Store } from '../db/store';
import { AppError } from '../errors';
import { assertAvailable } from '../media/files';
import { receiveUpload } from '../media/upload';
import { extractZip } from './extract';
import { inspectDatabase, sanitizeDatabase } from './database';
import { BACKUP_LIMITS, digestFile, invalidBackup, manifestSchema, validateEntryPath, type FileRecord, type Manifest } from './manifest';

export interface ValidatedBackup { id: string; summary: { assets: number; createdAt: string }; expiresAt: string }
interface Pending extends ValidatedBackup { directory: string; files: FileRecord[]; manifest: Manifest; timer: ReturnType<typeof setTimeout> }
export class RestoreManager {
  private pending = new Map<string, Pending>();
  constructor(private store: Store) {}
  async validate(request: Request): Promise<ValidatedBackup> {
    assertAvailable(this.store);
    const upload = await receiveUpload(request, join(this.store.root, 'tmp'), () => BACKUP_LIMITS.archiveBytes);
    const id = randomUUID(), directory = `store-${randomUUID()}`, path = join(this.store.root, directory);
    let keep = false;
    try {
      await mkdir(path, { mode: 0o700 });
      await mkdir(join(path, 'files'), { mode: 0o700 }); await mkdir(join(path, 'derived'), { mode: 0o700 });
      const extracted = await extractZip(upload.path, path);
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')));
      verifyManifest(manifest, extracted);
      const summary = { ...inspectDatabase(join(path, 'db.sqlite'), path, manifest.files, manifest.knowledgeVersion), createdAt: manifest.createdAt };
      sanitizeDatabase(join(path, 'db.sqlite'));
      const files = await Promise.all(extracted.map(async file => ({ path: file.path, ...await digestFile(join(path, file.path)) })));
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const timer = setTimeout(() => { this.pending.delete(id); void rm(path, { recursive: true, force: true }).catch(() => {}); }, 30 * 60 * 1000);
      timer.unref();
      this.pending.set(id, { id, directory, summary, expiresAt, manifest, files, timer });
      keep = true;
      return { id, summary, expiresAt };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_BACKUP', '备份损坏、结构不兼容或校验失败，当前资料库未改变');
    } finally {
      await rm(upload.path, { force: true });
      if (!keep) await rm(path, { recursive: true, force: true });
    }
  }
  async restore(id: string, confirm: boolean) {
    if (!confirm) throw new AppError(400, 'CONFIRM_REQUIRED', '恢复资料库需要明确确认');
    assertAvailable(this.store);
    if (this.store.assetPins) throw new AppError(409, 'ASSETS_PINNED', '文件正在使用或备份，请稍后恢复');
    const pending = this.pending.get(id);
    if (!pending) throw new AppError(404, 'NOT_FOUND', '请先上传并校验备份');
    if (Date.parse(pending.expiresAt) <= Date.now()) throw new AppError(410, 'BACKUP_EXPIRED', '备份校验已过期，请重新上传');
    const path = join(this.store.root, pending.directory);
    this.pending.delete(id); clearTimeout(pending.timer);
    this.store.maintenance = true;
    let switched = false;
    try {
      for (const file of pending.files) {
        const target = join(path, file.path);
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink()) invalidBackup('暂存文件类型已改变');
        const actual = await digestFile(target);
        if (actual.sha256 !== file.sha256 || actual.size !== file.size) invalidBackup('暂存文件已改变，请重新校验');
      }
      inspectDatabase(join(path, 'db.sqlite'), path, pending.manifest.files, pending.manifest.knowledgeVersion);
      this.store.switchDirectory(pending.directory);
      switched = true;
      return { restored: true as const };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_BACKUP', '恢复失败，当前资料库未改变');
    } finally {
      this.store.maintenance = false;
      if (!switched) await rm(path, { recursive: true, force: true });
    }
  }
}
function verifyManifest(manifest: Manifest, extracted: FileRecord[]) {
  const actual = new Map(extracted.map(file => [file.path, file]));
  const seen = new Set<string>();
  for (const file of manifest.files) {
    validateEntryPath(file.path);
    if (file.path === 'manifest.json' || seen.has(file.path.toLowerCase())) invalidBackup('校验清单包含重复或非法路径');
    seen.add(file.path.toLowerCase());
    const entry = actual.get(file.path);
    if (!entry || entry.sha256 !== file.sha256 || entry.size !== file.size) invalidBackup('文件哈希或大小校验失败');
  }
  if (!actual.has('db.sqlite') || !actual.has('manifest.json') || actual.size !== manifest.files.length + 1) invalidBackup('备份文件清单不完整');
}
