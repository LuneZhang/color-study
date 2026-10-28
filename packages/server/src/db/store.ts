import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors';
import { migration, migrationV2, SCHEMA_VERSION } from './schema';

export const tables = ['tutorials', 'knowledge', 'assets', 'sources', 'library', 'reviews', 'practices', 'practice_exports', 'conversations', 'messages'] as const;
export type Table = typeof tables[number];
const extraColumns: Partial<Record<Table, Record<string, string>>> = {
  library: { thumbnail_asset_id: 'thumbnailAssetId' }, reviews: { tutorial_id: 'tutorialId' },
  practices: { tutorial_id: 'tutorialId', raw_asset_id: 'rawAssetId' },
  practice_exports: { practice_id: 'practiceId', asset_id: 'assetId' }, messages: { conversation_id: 'conversationId' },
};
export function entity<T extends object>(data: T) {
  const now = new Date().toISOString();
  return { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
}
export class Store {
  db: Database.Database;
  dataDir: string;
  maintenance = false;
  assetPins = 0;
  constructor(public root = process.env.COLOR_STUDY_DATA ?? join(homedir(), 'Library', 'Application Support', 'ColorStudy')) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    let active = 'store';
    const pointer = join(this.root, 'active.json');
    if (existsSync(pointer)) active = JSON.parse(readFileSync(pointer, 'utf8')).directory;
    if (!/^[a-zA-Z0-9_-]+$/.test(active)) throw new Error('Invalid data directory pointer');
    this.dataDir = join(this.root, active);
    this.ensureDirectories();
    this.db = this.open(this.dataDir);
  }
  private ensureDirectories() {
    for (const path of [this.dataDir, join(this.dataDir, 'files'), join(this.dataDir, 'derived'), join(this.root, 'tmp'), join(this.root, 'backups')]) mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  private open(directory: string) {
    const db = new Database(join(directory, 'db.sqlite'));
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > SCHEMA_VERSION) { db.close(); throw new Error('此数据库来自较新的应用版本'); }
    if (version === 0) db.transaction(() => db.exec(migration))();
    const current = db.pragma('user_version', { simple: true }) as number;
    if (current < 2) db.transaction(() => db.exec(migrationV2))();
    return db;
  }
  get<T>(table: Table, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  list<T>(table: Table): T[] {
    return (this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T);
  }
  put<T extends { id: string }>(table: Table, value: T): T {
    const extra = Object.entries(extraColumns[table] ?? {});
    const columns = ['id', 'data', ...extra.map(([column]) => column)];
    const args = [value.id, JSON.stringify(value), ...extra.map(([, field]) => (value as Record<string, unknown>)[field] ?? null)];
    this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(column => `${column}=excluded.${column}`).join(',')}`).run(...args);
    return value;
  }
  remove(table: Table, id: string) { return this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); }
  setting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  path(relativePath: string) {
    const result = resolve(this.dataDir, relativePath);
    if (isAbsolute(relativePath) || !result.startsWith(this.dataDir + sep) || relativePath.includes('\0')) throw new AppError(400, 'INVALID_PATH', '无效的资产路径');
    return result;
  }
  switchDirectory(directory: string) {
    if (!/^store-[a-zA-Z0-9_-]+$/.test(directory)) throw new AppError(400, 'INVALID_PATH', '无效的恢复目录');
    const nextDir = join(this.root, directory);
    if (!existsSync(join(nextDir, 'db.sqlite'))) throw new AppError(400, 'INVALID_BACKUP', '恢复数据库不存在');
    const next = this.open(nextDir);
    const temp = join(this.root, `active-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify({ directory }), { mode: 0o600 });
    renameSync(temp, join(this.root, 'active.json'));
    this.db.close();
    this.db = next;
    this.dataDir = nextDir;
    this.ensureDirectories();
  }
  close() { this.db.close(); }
}
