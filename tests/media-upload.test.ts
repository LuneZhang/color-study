import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { Hono } from 'hono';
import { MEDIA_LIMITS } from '../packages/shared/src/media';
import { receiveUpload } from '../packages/server/src/media/upload';
import { uploadLimit, detectFormat } from '../packages/server/src/media/formats';
import { Store } from '../packages/server/src/db/store';
import { createMediaRouter } from '../packages/server/src/media';
import { AppError } from '../packages/server/src/errors';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'color-study-media-limit-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function streamedUpload(name: string, size: number) {
  const boundary = 'media-limit-test';
  async function* body() {
    yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const chunk = Buffer.alloc(1024 * 1024, 0x42);
    for (let remaining = size; remaining > 0; remaining -= chunk.length) yield chunk.subarray(0, Math.min(remaining, chunk.length));
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }
  return new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Readable.toWeb(Readable.from(body())) as ReadableStream, duplex: 'half' } as RequestInit);
}
describe('streaming upload limits', () => {
  it.each([['image.jpg', MEDIA_LIMITS.imageBytes], ['camera.nef', MEDIA_LIMITS.rawBytes]])('rejects oversized %s without buffering the file', async (name, limit) => {
    expect(uploadLimit(name)).toBe(limit);
    await expect(receiveUpload(streamedUpload(name, limit + 1), root, uploadLimit)).rejects.toMatchObject({ status: 413 });
    expect(await readdir(root)).toEqual([]);
  }, 30000);
  it('accepts the exact limit and validates late metadata independently of file ordering', async () => {
    const upload = await receiveUpload(streamedUpload('test.jpg', 1024), root, () => 1024);
    expect(upload.size).toBe(1024); expect(upload.prefix.length).toBe(64); expect(upload.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects missing or duplicate files and truncated forms', async () => {
    const form = new FormData(); form.append('file', new Blob(['one']), 'a.jpg'); form.append('file', new Blob(['two']), 'b.jpg');
    await expect(receiveUpload(new Request('http://localhost/', { method: 'POST', body: form }), root, uploadLimit)).rejects.toMatchObject({ status: 400 });
    const empty = new FormData(); empty.set('meta', '{}');
    await expect(receiveUpload(new Request('http://localhost/', { method: 'POST', body: empty }), root, uploadLimit)).rejects.toMatchObject({ status: 400 });
    await expect(receiveUpload(new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\n' }), root, uploadLimit)).rejects.toMatchObject({ status: 400 });
    expect(await readdir(root)).toEqual([]);
  });
  it('recognizes common RAW signatures without decoding', () => {
    for (const [name, signature] of [['a.cr2', '49492a000800000043520200'], ['a.cr3', '000000186674797063727820'], ['a.orf', '4949524f'], ['a.rw2', '49495500'], ['a.mrw', '004d524d'], ['a.x3f', '464f5662'], ['a.raf', Buffer.from('FUJIFILMCCD-RAW ').toString('hex')]]) {
      expect(detectFormat(name, Buffer.from(signature, 'hex')).kind).toBe('raw');
    }
    expect(() => detectFormat('a.cr3', Buffer.from('49492a00', 'hex'))).toThrow();
  });
  it('rejects a PNG declaring more than 100 million pixels before decoding', async () => {
    const store = new Store(root), app = new Hono().route('/api/assets', createMediaRouter(store));
    app.onError((error, c) => c.json({ error: error.message }, (error instanceof AppError ? error.status : 500) as 400));
    try {
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
      bytes.writeUInt32BE(10001, 16); bytes.writeUInt32BE(10000, 20);
      let crc = 0xffffffff;
      for (const byte of bytes.subarray(12, 29)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
      bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
      const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)]), 'huge.png'); form.set('meta', JSON.stringify({ rightsEvidence: '自有测试', canAnalyze: true }));
      const response = await app.request('/api/assets', { method: 'POST', body: form });
      expect(response.status).toBe(413); expect(store.list('assets')).toEqual([]);
    } finally { store.close(); }
  });
});
