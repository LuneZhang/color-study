import Database from 'better-sqlite3';
import { ZipFile } from 'yazl';
import { createWriteStream, lstatSync } from 'node:fs';
import { mkdir, rm, rename, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Store } from '../db/store';
import { AppError } from '../errors';
import { assertAvailable, managedPath } from '../media/files';
import { SCHEMA_VERSION } from '../db/schema';
import { sanitizeDatabase, snapshotAssets } from './database';
import { BACKUP_LIMITS, digestFile, requireSpace, type Manifest, type FileRecord } from './manifest';

export interface BackupInfo { id: string; name: string; size: number; createdAt: string }
export function backupPath(store: Store, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new AppError(404, 'NOT_FOUND', '未找到备份');
  return join(store.root, 'backups', `${id}.zip`);
}
export async function backupInfo(store: Store, id: string): Promise<BackupInfo> {
  const path = backupPath(store, id);
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink()) throw new AppError(404, 'NOT_FOUND', '未找到备份');
  return { id, name: `color-study-${id}.zip`, size: info.size, createdAt: info.mtime.toISOString() };
}
export async function listBackups(store: Store) {
  const names = await readdir(join(store.root, 'backups'));
  const items: BackupInfo[] = [];
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.zip$/.test(name)) continue;
    items.push(await backupInfo(store, name.slice(0, -4)));
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function fixedSnapshot(store: Store, target: string) {
  const source = new Database(store.path('db.sqlite'), { readonly: true, fileMustExist: true });
  try {
    source.exec('BEGIN'); source.prepare('SELECT count(*) FROM assets').get();
    await source.backup(target);
  } finally { source.close(); }
  sanitizeDatabase(target);
}
async function writeZip(path: string, manifest: Manifest, sources: Map<string, string>) {
  const zip = new ZipFile();
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  zip.on('error', error => output.destroy(error));
  const writing = pipeline(zip.outputStream, output);
  try {
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    for (const file of manifest.files) zip.addFile(sources.get(file.path)!, file.path, { mode: 0o100600 });
    zip.end();
    await writing;
  } catch (error) { output.destroy(); await writing.catch(() => {}); throw error; }
}
export async function createBackup(store: Store): Promise<BackupInfo> {
  assertAvailable(store);
  store.assetPins++;
  const id = randomUUID();
  const directory = join(store.root, 'tmp', `snapshot-${id}`);
  const pending = join(store.root, 'backups', `${id}.pending`);
  try {
    await mkdir(directory, { mode: 0o700 });
    const database = join(directory, 'db.sqlite');
    await requireSpace(store.root, (await stat(store.path('db.sqlite'))).size * 3);
    await fixedSnapshot(store, database);
    const snapshot = snapshotAssets(database);
    const sources = new Map([['db.sqlite', database]]);
    for (const asset of snapshot.assets) {
      for (const path of [asset.relativePath, asset.previewPath, asset.thumbnailPath]) if (path) sources.set(path, managedPath(store.dataDir, path));
    }
    if (sources.size > BACKUP_LIMITS.entries) throw new AppError(413, 'BACKUP_TOO_LARGE', '备份文件数超过上限');
    const files: FileRecord[] = [];
    for (const [path, source] of sources) files.push({ path, ...await digestFile(source) });
    const size = files.reduce((sum, file) => sum + file.size, 0);
    if (size > BACKUP_LIMITS.expandedBytes || files.some(file => file.size > BACKUP_LIMITS.fileBytes)) throw new AppError(413, 'BACKUP_TOO_LARGE', '备份超过大小上限');
    await requireSpace(store.root, size + Math.ceil(size / 100) + 1024 ** 2);
    const manifest: Manifest = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), knowledgeVersion: snapshot.knowledgeVersion, files };
    await writeZip(pending, manifest, sources);
    if ((await stat(pending)).size > BACKUP_LIMITS.archiveBytes) throw new AppError(413, 'BACKUP_TOO_LARGE', '压缩备份超过大小上限');
    await rename(pending, backupPath(store, id));
    return await backupInfo(store, id);
  } finally {
    await Promise.all([rm(directory, { recursive: true, force: true }), rm(pending, { force: true })]);
    store.assetPins--;
  }
}
