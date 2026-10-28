import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { Store, entity } from '../packages/server/src/db/store';
import { AppError } from '../packages/server/src/errors';
import { createMediaRouter } from '../packages/server/src/media';
import { createBackupRouter } from '../packages/server/src/backup';
import { createBackup } from '../packages/server/src/backup/snapshot';
import { extractZip } from '../packages/server/src/backup/extract';
import { mkdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import type { Asset } from '../packages/shared/src/media';

let root: string, store: Store, app: Hono;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'color-study-backup-test-')); store = new Store(root);
  app = new Hono().route('/api/assets', createMediaRouter(store)).route('/api/backups', createBackupRouter(store));
  app.onError((error, c) => c.json({ error: error.message }, (error instanceof AppError ? error.status : 500) as 400));
});
afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
async function importImage() {
  const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#20aa44' } }).png().toBuffer();
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(image)]), 'original.png'); form.set('meta', JSON.stringify({ owned: true, rightsEvidence: '自有测试照片', canAnalyze: true }));
  const response = await app.request('/api/assets', { method: 'POST', body: form }); expect(response.status).toBe(201);
  return await response.json() as Asset;
}
async function validate(bytes: Buffer) {
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)]), 'backup.zip');
  return app.request('/api/backups/validate', { method: 'POST', body: form });
}
const restore = (id: string, confirm: unknown = true) => app.request('/api/backups/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, confirm }) });
describe('real SQLite / ZIP backup and restore', () => {
  it('backs up a fixed database view, strips credential references, restores only on confirmation and retains the old store', async () => {
    const asset = await importImage(); const original = await readFile(store.path(asset.relativePath));
    store.setSetting('provider', { name: 'private test', baseUrl: 'https://example.com/v1', keyRef: 'keychain-reference-not-a-secret', hasKey: true, enabled: true, apiKey: 'must-never-export' });
    store.setSetting('providers', [{ keyRef: 'another-ref', hasKey: true, enabled: true }]);
    const card = store.put('knowledge', entity({ title: 'test concept', body: '原始内容', sources: [] }));
    const oldDirectory = store.dataDir;
    const created = await app.request('/api/backups', { method: 'POST' }); expect(created.status).toBe(201);
    const info = await created.json(); expect(info.size).toBeGreaterThan(0);
    const list = await (await app.request('/api/backups')).json(); expect(list.items).toHaveLength(1);
    const download = await app.request(`/api/backups/${info.id}/download`); expect(download.headers.get('content-type')).toBe('application/zip');
    const bytes = Buffer.from(await download.arrayBuffer());
    store.put('knowledge', { ...card, body: '备份后的修改' });
    const checked = await validate(bytes); expect(checked.status).toBe(200);
    const validation = await checked.json(); expect(validation.summary.assets).toBe(1); expect(Date.parse(validation.expiresAt)).toBeGreaterThan(Date.now());
    expect(store.dataDir).toBe(oldDirectory); expect(store.setting('provider')).toMatchObject({ enabled: true, hasKey: true });
    expect((await restore(validation.id, false)).status).toBe(400); expect(store.dataDir).toBe(oldDirectory);
    expect((await restore(validation.id)).status).toBe(200); expect(store.dataDir).not.toBe(oldDirectory);
    await expect(access(join(oldDirectory, 'db.sqlite'))).resolves.toBeUndefined();
    expect(await readFile(store.path(asset.relativePath))).toEqual(original);
    expect(store.get('knowledge', card.id)).toMatchObject({ body: '原始内容' });
    expect(store.setting('provider')).toEqual({ name: 'private test', baseUrl: 'https://example.com/v1', enabled: false });
    expect(store.setting('providers')).toEqual([{ enabled: false }]);
    expect((await restore(validation.id)).status).toBe(404);
    const restoredDirectory = store.dataDir; store.close(); store = new Store(root); expect(store.dataDir).toBe(restoredDirectory);
  });
  it('pins immutable assets while a snapshot is running and does not mutate live provider settings', async () => {
    const asset = await importImage();
    store.setSetting('provider', { keyRef: 'never-in-backup-bytes', hasKey: true, enabled: true });
    const pending = createBackup(store); expect(store.assetPins).toBe(1);
    expect((await app.request(`/api/assets/${asset.id}?confirm=true`, { method: 'DELETE' })).status).toBe(409);
    const info = await pending; expect(store.assetPins).toBe(0); expect(store.setting('provider')).toMatchObject({ enabled: true });
    const extracted = join(root, 'inspect'); await mkdir(extracted); await mkdir(join(extracted, 'files')); await mkdir(join(extracted, 'derived'));
    await extractZip(join(root, 'backups', `${info.id}.zip`), extracted);
    const database = await readFile(join(extracted, 'db.sqlite'));
    expect(database.includes(Buffer.from('never-in-backup-bytes'))).toBe(false); expect(database.includes(Buffer.from('hasKey'))).toBe(false);
    const db = new Database(join(extracted, 'db.sqlite'), { readonly: true });
    try { expect(db.pragma('integrity_check', { simple: true })).toBe('ok'); } finally { db.close(); }
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
  it('rejects corrupted packages without switching the current database', async () => {
    const asset = await importImage(), old = store.dataDir;
    const response = await validate(Buffer.from('broken zip')); expect(response.status).toBe(400);
    expect(store.dataDir).toBe(old); expect(store.get('assets', asset.id)).toBeDefined();
    expect((await readdir(root)).filter(name => name.startsWith('store-'))).toEqual([]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
  it('refuses switching while pinned, then restores a validated empty backup', async () => {
    const info = await createBackup(store);
    const checked = await validate(await readFile(join(root, 'backups', `${info.id}.zip`))); expect(checked.status).toBe(200);
    const validation = await checked.json(); store.assetPins++;
    expect((await restore(validation.id)).status).toBe(409); store.assetPins--;
    expect((await restore(validation.id)).status).toBe(200); expect(store.maintenance).toBe(false);
  });
});
