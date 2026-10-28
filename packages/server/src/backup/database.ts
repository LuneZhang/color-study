import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Asset } from '../../../shared/src/media';
import { assetMetaInput } from '../../../shared/src/media';
import { migration, SCHEMA_VERSION } from '../db/schema';
import { managedPath } from '../media/files';
import { invalidBackup, type FileRecord } from './manifest';

const credentials = /^(keyRef|hasKey|apiKey|api_key|accessToken|access_token|secret|authorization)$/i;
function stripCredentials(value: unknown, provider: boolean): unknown {
  if (Array.isArray(value)) return value.map(item => stripCredentials(item, provider));
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const isProvider = provider || 'baseUrl' in input || 'keyRef' in input || 'hasKey' in input;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(input)) {
    if (credentials.test(key)) continue;
    result[key] = key === 'enabled' && isProvider ? false : stripCredentials(item, isProvider || /provider/i.test(key));
  }
  if (isProvider) result.enabled = false;
  return result;
}
export function sanitizeDatabase(path: string) {
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma('journal_mode = DELETE'); db.pragma('secure_delete = ON');
    const settings = db.prepare('SELECT key,value FROM settings').all() as { key: string; value: string }[];
    db.transaction(() => {
      for (const row of settings) {
        if (credentials.test(row.key)) { db.prepare('DELETE FROM settings WHERE key = ?').run(row.key); continue; }
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(stripCredentials(JSON.parse(row.value), /provider/i.test(row.key))), row.key);
      }
    })();
    db.exec('VACUUM');
  } finally { db.close(); }
}
export function knowledgeVersion(db: Database.Database) {
  return createHash('sha256').update(JSON.stringify(db.prepare('SELECT id,data FROM knowledge ORDER BY id').all())).digest('hex');
}
function verifySchema(db: Database.Database) {
  if (db.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) invalidBackup('备份数据库版本不兼容');
  const expected = new Database(':memory:');
  try {
    expected.exec(migration);
    const schema = (connection: Database.Database) => JSON.stringify(connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all());
    if (schema(db) !== schema(expected)) invalidBackup('备份数据库结构不兼容或包含额外可执行结构');
  } finally { expected.close(); }
  if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) invalidBackup('备份数据库损坏或包含失效引用');
}
const assetSchema = assetMetaInput.omit({ tutorialId: true, pairingEvidence: true }).extend({
  id: z.string().min(1), name: z.string(), kind: z.enum(['image', 'raw']), mime: z.string(), size: z.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), relativePath: z.string(), previewPath: z.string().nullable(), thumbnailPath: z.string().nullable(),
  width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export function inspectDatabase(path: string, directory: string, files: FileRecord[], expectedKnowledge: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    verifySchema(db);
    if (knowledgeVersion(db) !== expectedKnowledge) invalidBackup('知识内容版本校验失败');
    const records = new Map(files.map(file => [file.path, file]));
    const used = new Set(['db.sqlite']);
    const rows = db.prepare('SELECT id,data FROM assets').all() as { id: string; data: string }[];
    for (const row of rows) {
      const result = assetSchema.safeParse(JSON.parse(row.data));
      if (!result.success || result.data.id !== row.id) invalidBackup('资产元信息不完整');
      const asset = result.data;
      const original = records.get(asset.relativePath);
      if (!original || original.sha256 !== asset.hash || original.size !== asset.size) invalidBackup('数据库原文件引用与校验清单不一致');
      if ((asset.kind === 'raw' || !asset.canAnalyze) && (asset.previewPath || asset.thumbnailPath)) invalidBackup('无处理权限的素材不能包含派生图');
      for (const [relative, area] of [[asset.relativePath, 'files'], [asset.previewPath, 'derived'], [asset.thumbnailPath, 'derived']] as const) {
        if (!relative) continue;
        if (!records.has(relative)) invalidBackup('数据库引用了缺失的托管文件');
        managedPath(directory, relative, area); used.add(relative);
      }
    }
    if (used.size !== records.size) invalidBackup('备份包含数据库未引用的文件');
    return { assets: rows.length };
  } finally { db.close(); }
}
export function snapshotAssets(path: string) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const assets = (db.prepare('SELECT data FROM assets').all() as { data: string }[]).map(row => JSON.parse(row.data) as Asset);
    return { assets, knowledgeVersion: knowledgeVersion(db) };
  } finally { db.close(); }
}
