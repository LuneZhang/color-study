import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Store, entity } from '../packages/server/src/db/store';
import { AppError } from '../packages/server/src/errors';
import { createMediaRouter, makeAiImage } from '../packages/server/src/media';
import { analyzePixels } from '../packages/server/src/media/analysis';
import type { Asset } from '../packages/shared/src/media';

let store: Store, app: Hono, root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'color-study-media-test-')); store = new Store(root);
  app = new Hono().route('/api/assets', createMediaRouter(store));
  app.onError((error, c) => c.json({ error: error.message }, (error instanceof AppError ? error.status : 500) as 400));
});
afterEach(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
const meta = { rightsEvidence: '自有拍摄测试素材', owned: true, canAnalyze: true };
async function upload(bytes: Buffer, name = 'test.png', metadata: unknown = meta) {
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)]), name); form.set('meta', JSON.stringify(metadata));
  return app.request('/api/assets', { method: 'POST', body: form });
}
const png = () => sharp({ create: { width: 60, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
describe('media integration', () => {
  it('copies originals, generates sized sRGB derivatives and serves/downloads bytes', async () => {
    const original = await sharp({ create: { width: 3000, height: 1800, channels: 3, background: '#208060' } }).jpeg().withExif({ IFD0: { Artist: 'private artist' } }).toBuffer();
    const response = await upload(original, '测试.jpg'); expect(response.status).toBe(201);
    const asset = await response.json() as Asset;
    expect(await readFile(store.path(asset.relativePath))).toEqual(original);
    expect(asset.analysis?.histogram).toHaveLength(32);
    expect(asset.analysis!.colors.reduce((sum, color) => sum + color.ratio, 0)).toBeCloseTo(1);
    const preview = await sharp(store.path(asset.previewPath!)).metadata();
    const thumbnail = await sharp(store.path(asset.thumbnailPath!)).metadata();
    expect(preview.width).toBe(2560); expect(thumbnail.width).toBe(480); expect(preview.space).toBe('srgb'); expect(preview.exif).toBeUndefined();
    const dataUrl = await makeAiImage(store, asset.id);
    const ai = Buffer.from(dataUrl.split(',')[1], 'base64'), aiMeta = await sharp(ai).metadata();
    expect(aiMeta.width).toBe(1600); expect(ai.length).toBeLessThanOrEqual(2 * 1024 ** 2); expect(aiMeta.exif).toBeUndefined();
    const file = await app.request(`/api/assets/${asset.id}/file`);
    expect(file.headers.get('content-disposition')).toContain('attachment'); expect(Buffer.from(await file.arrayBuffer())).toEqual(original);
    const thumb = await app.request(`/api/assets/${asset.id}/file?variant=thumbnail`); expect(thumb.status).toBe(200); await thumb.arrayBuffer();
    expect((await (await app.request('/api/assets')).json()).total).toBe(1);
    expect((await (await app.request(`/api/assets/${asset.id}`)).json()).id).toBe(asset.id);
    expect((await app.request(`/api/assets/${asset.id}/file?variant=other`)).status).toBe(400);
  });
  it('does not analyze or generate derivatives without permission', async () => {
    const asset = await (await upload(await png(), 'test.png', { ...meta, canAnalyze: false })).json() as Asset;
    expect(asset.analysis).toBeNull(); expect(asset.previewPath).toBeNull(); expect(asset.thumbnailPath).toBeNull();
    expect(await readdir(join(store.dataDir, 'derived'))).toEqual([]);
    await expect(makeAiImage(store, asset.id)).rejects.toMatchObject({ status: 403 });
    expect((await app.request(`/api/assets/${asset.id}/file?variant=preview`)).status).toBe(403);
  });
  it('keeps RAW opaque without asking sharp to decode it', async () => {
    const raw = Buffer.concat([Buffer.from('49492a0008000000', 'hex'), Buffer.alloc(60, 0xa5)]);
    const response = await upload(raw, 'source.NEF'); expect(response.status).toBe(201);
    const asset = await response.json() as Asset;
    expect(asset.kind).toBe('raw'); expect(asset.width).toBeNull(); expect(asset.analysis).toBeNull(); expect(asset.previewPath).toBeNull();
    expect(await readFile(store.path(asset.relativePath))).toEqual(raw);
    await expect(makeAiImage(store, asset.id)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects bad signatures, corrupt images and missing legal evidence with no orphan files', async () => {
    expect((await upload(Buffer.from('not an image'))).status).toBe(415);
    expect((await upload(Buffer.from('ffd8ff001122', 'hex'), 'broken.jpg')).status).toBe(400);
    expect((await upload(await png(), 'x.png', {})).status).toBe(400);
    expect((await upload(await png(), 'x.nef')).status).toBe(415);
    expect((await upload(await png(), 'x.svg')).status).toBe(415);
    expect(await readdir(join(store.dataDir, 'files'))).toEqual([]); expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(store.assetPins).toBe(0);
  });
  it('requires pairing evidence and only unlinks a tutorial without deleting the asset', async () => {
    const tutorial = store.put('tutorials', entity({ title: '真实教程测试', url: 'https://example.com/tutorial' }));
    expect((await upload(await png(), 'x.png', { ...meta, tutorialId: tutorial.id })).status).toBe(400);
    const asset = await (await upload(await png())).json() as Asset;
    const link = (evidence: string) => app.request(`/api/assets/${asset.id}/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tutorialId: tutorial.id, role: 'tutorial_raw', evidence }) });
    expect((await link('')).status).toBe(400); expect((await link('作者说明此文件配套')).status).toBe(200);
    expect((await app.request(`/api/assets/${asset.id}?confirm=true`, { method: 'DELETE' })).status).toBe(409);
    expect((await app.request(`/api/assets/${asset.id}/link/${tutorial.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(store.get('assets', asset.id)).toBeDefined();
    expect((await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(400);
    expect((await app.request(`/api/assets/${asset.id}?confirm=true`, { method: 'DELETE' })).status).toBe(200);
    expect(await readdir(join(store.dataDir, 'files'))).toEqual([]); expect(await readdir(join(store.dataDir, 'derived'))).toEqual([]);
  });
  it.each(['library', 'practices', 'practice_exports', 'message_assets'])('protects %s FK references', async table => {
    const asset = await (await upload(await png())).json() as Asset;
    if (table === 'library') store.put('library', entity({ thumbnailAssetId: asset.id, url: 'https://example.com/item' }));
    if (table === 'practices') store.put('practices', entity({ rawAssetId: asset.id }));
    if (table === 'practice_exports') {
      const practice = store.put('practices', entity({ rawAssetId: null }));
      store.put('practice_exports', entity({ practiceId: practice.id, assetId: asset.id }));
    }
    if (table === 'message_assets') {
      const conversation = store.put('conversations', entity({ pageKey: 'test' }));
      const message = store.put('messages', entity({ conversationId: conversation.id }));
      store.db.prepare('INSERT INTO message_assets(message_id,asset_id) VALUES (?,?)').run(message.id, asset.id);
    }
    expect((await app.request(`/api/assets/${asset.id}?confirm=true`, { method: 'DELETE' })).status).toBe(409);
    expect(await readFile(store.path(asset.relativePath))).toBeDefined();
  });
  it('blocks deletion and AI generation during protected operations', async () => {
    const asset = await (await upload(await png())).json() as Asset;
    store.assetPins++;
    expect((await app.request(`/api/assets/${asset.id}?confirm=true`, { method: 'DELETE' })).status).toBe(409);
    store.assetPins--; store.maintenance = true;
    await expect(makeAiImage(store, asset.id)).rejects.toMatchObject({ status: 503 });
    expect((await upload(await png())).status).toBe(503);
  });
});
describe('deterministic median cut analysis', () => {
  it('excludes transparent pixels from palette and brightness bins', () => {
    const pixels = Buffer.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0]);
    const analysis = analyzePixels(pixels)!;
    expect(analysis.pixelCount).toBe(4); expect(analysis.colors).toEqual([{ hex: '#ff0000', ratio: 1 }]);
    expect(analysis.histogram.reduce((a, b) => a + b, 0)).toBe(4); expect(analysis.histogram[6]).toBe(4);
    expect(analyzePixels(Buffer.alloc(32))).toBeNull(); expect(analyzePixels(pixels)).toEqual(analysis);
  });
});
