import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipFile } from 'yazl';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { Store } from '../packages/server/src/db/store';
import { AppError } from '../packages/server/src/errors';
import { createMediaRouter } from '../packages/server/src/media';
import { createBackupRouter } from '../packages/server/src/backup';
import { createBackup } from '../packages/server/src/backup/snapshot';
import { extractZip } from '../packages/server/src/backup/extract';
import { BACKUP_LIMITS, digestFile, setSpaceProbeForTests, type Manifest } from '../packages/server/src/backup/manifest';

let root: string, store: Store, app: Hono, fixture: string, manifest: Manifest;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'color-study-backup-validation-test-')); store = new Store(root);
  app = new Hono().route('/api/assets', createMediaRouter(store)).route('/api/backups', createBackupRouter(store));
  app.onError((error, c) => c.json({ error: error.message }, (error instanceof AppError ? error.status : 500) as 400));
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer();
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(image)]), 'test.png'); form.set('meta', JSON.stringify({ rightsEvidence: '自有测试', canAnalyze: true }));
  expect((await app.request('/api/assets', { method: 'POST', body: form })).status).toBe(201);
  const backup = await createBackup(store);
  fixture = join(root, 'fixture'); await fs.mkdir(fixture); await fs.mkdir(join(fixture, 'files')); await fs.mkdir(join(fixture, 'derived'));
  await extractZip(join(root, 'backups', `${backup.id}.zip`), fixture);
  manifest = JSON.parse(await fs.readFile(join(fixture, 'manifest.json'), 'utf8'));
});
afterEach(async () => { setSpaceProbeForTests(null); vi.restoreAllMocks(); store.close(); await fs.rm(root, { recursive: true, force: true }); });
async function zipBytes(entries: { path: string; data: Buffer; mode?: number }[]) {
  const zip = new ZipFile();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); zip.on('error', reject);
  });
  for (const entry of entries) zip.addBuffer(entry.data, entry.path, { mode: entry.mode });
  zip.end(); return done;
}
async function repack() {
  return zipBytes([{ path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }, ...await Promise.all(manifest.files.map(async file => ({ path: file.path, data: await fs.readFile(join(fixture, file.path)) })))]);
}
async function validate(bytes: Buffer) {
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)]), 'upload.zip');
  return app.request('/api/backups/validate', { method: 'POST', body: form });
}
async function expectInvalid(bytes: Buffer, status = 400) {
  const directory = store.dataDir;
  const response = await validate(bytes); expect(response.status).toBe(status);
  expect(store.dataDir).toBe(directory); expect(store.list('assets')).toHaveLength(1);
  expect((await fs.readdir(root)).filter(name => name.startsWith('store-'))).toEqual([]);
  expect(await fs.readdir(join(root, 'tmp'))).toEqual([]);
}
function replaceNames(bytes: Buffer, from: string, to: string) {
  expect(from.length).toBe(to.length);
  let offset = bytes.indexOf(from);
  while (offset >= 0) { bytes.write(to, offset); offset = bytes.indexOf(from, offset + to.length); }
  return bytes;
}
async function editDatabase(sql: string) {
  const db = new Database(join(fixture, 'db.sqlite'));
  try { db.exec(sql); } finally { db.close(); }
  const file = manifest.files.find(file => file.path === 'db.sqlite')!;
  Object.assign(file, await digestFile(join(fixture, 'db.sqlite')));
}
describe('adversarial ZIP validation', () => {
  it.each(['../evil', '/root/x', 'C:/evil', 'files\\a'])('rejects path %s before writing outside staging', async name => {
    const bytes = await zipBytes([{ path: 'files/a', data: Buffer.from('bad') }]);
    await expectInvalid(replaceNames(bytes, 'files/a', name));
  });
  it('rejects duplicate paths including case-insensitive collisions', async () => {
    await expectInvalid(await zipBytes([{ path: 'files/a', data: Buffer.from('one') }, { path: 'files/a', data: Buffer.from('two') }]));
    await expectInvalid(await zipBytes([{ path: 'files/a', data: Buffer.from('one') }, { path: 'files/A', data: Buffer.from('two') }]));
  });
  it('rejects symbolic links and encrypted entries', async () => {
    await expectInvalid(await zipBytes([{ path: 'files/link', data: Buffer.from('/outside'), mode: 0o120777 }]));
    const bytes = await repack(), central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
    await expectInvalid(bytes);
  });
  it('rejects declared excessive expansion before decompressing', async () => {
    const bytes = await zipBytes([{ path: 'files/a', data: Buffer.from('small') }]);
    const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
    bytes.writeUInt32LE(BACKUP_LIMITS.fileBytes + 1, central + 24);
    await expectInvalid(bytes);
  });
  it('rejects insufficient disk space without touching the active library', async () => {
    const bytes = await repack();
    setSpaceProbeForTests(async () => ({ bavail: 0n, bsize: 4096n }));
    await expectInvalid(bytes, 507);
  });
  it('rejects missing files, hashes, duplicate manifest paths and incompatible schema versions', async () => {
    const original = structuredClone(manifest);
    manifest.files[1].sha256 = '0'.repeat(64); await expectInvalid(await repack());
    manifest = structuredClone(original); manifest.schemaVersion = 999 as typeof manifest.schemaVersion; await expectInvalid(await repack());
    manifest = structuredClone(original); manifest.files.push({ ...manifest.files[1] }); await expectInvalid(await repack());
    manifest = structuredClone(original);
    await expectInvalid(await zipBytes([{ path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) }]));
  });
  it('rejects SQLite references escaping the controlled directory', async () => {
    await editDatabase("UPDATE assets SET data=json_set(data,'$.relativePath','../../outside.png')");
    await expectInvalid(await repack());
  });
  it('rejects executable schema additions and broken foreign keys', async () => {
    await editDatabase("CREATE TRIGGER untrusted AFTER INSERT ON assets BEGIN DELETE FROM tutorials; END;");
    await expectInvalid(await repack());
    await editDatabase("DROP TRIGGER untrusted; PRAGMA foreign_keys=OFF; INSERT INTO tutorial_assets VALUES ('missing','absent','reference','bad')");
    await expectInvalid(await repack());
  });
  it('rechecks staged bytes before switching, protecting against post-validation corruption', async () => {
    const checked = await validate(await repack()); expect(checked.status).toBe(200);
    const validation = await checked.json(), old = store.dataDir;
    const staged = (await fs.readdir(root)).find(name => name.startsWith('store-'))!;
    await fs.appendFile(join(root, staged, manifest.files[1].path), 'tampered');
    const response = await app.request('/api/backups/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: validation.id, confirm: true }) });
    expect(response.status).toBe(400); expect(store.dataDir).toBe(old); expect(store.maintenance).toBe(false);
    expect((await fs.readdir(root)).filter(name => name.startsWith('store-'))).toEqual([]);
  });
});
