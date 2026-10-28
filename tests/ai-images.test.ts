import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import sharp from 'sharp';
import { Store, entity } from '../packages/server/src/db/store';
import { createAiRouter } from '../packages/server/src/ai';
import type { Asset } from '../packages/shared/src/media';
import type { ChatMessage } from '../packages/shared/src/ai';
import type { safeRequest } from '../packages/server/src/network';

let store: Store;
let app: Hono;
let asset: Asset;
const request = vi.fn<typeof safeRequest>();
const send = (input: object, path = '/chat') => app.request(`/api/ai${path}`, {
  method: path === '/config' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
});
const configure = (imageSupport: boolean) => send({ baseUrl: 'https://example.org/v1', model: 'image-mock', imageSupport, tokenParameter: 'max_completion_tokens', key: 'fake-image-test-key' }, '/config');
beforeEach(async () => {
  store = new Store(mkdtempSync(join(tmpdir(), 'color-ai-images-')));
  const keys = new Map<string, string>();
  request.mockReset();
  request.mockImplementation(async () => ({ statusCode: 200, headers: { 'content-type': 'text/event-stream' }, body: Readable.from([Buffer.from('data: [DONE]\n\n')]) }) as unknown as Awaited<ReturnType<typeof safeRequest>>);
  app = new Hono().route('/api/ai', createAiRouter(store, { request, credentials: { get: async id => keys.get(id) ?? null, set: async (id, key) => { keys.set(id, key); }, delete: async id => { keys.delete(id); } } }));
  await configure(true);
  const relativePath = 'files/test-photo.jpg';
  await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#557799' } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'private metadata fixture' } } }).toFile(store.path(relativePath));
  asset = entity({ name: 'test-photo.jpg', kind: 'image' as const, role: 'attachment' as const, mime: 'image/jpeg', size: 100, hash: 'fixture', relativePath, previewPath: null, thumbnailPath: null, width: 1800, height: 900, sourceUrl: '', rightsEvidence: 'self-owned test fixture, permission granted', canAnalyze: true, owned: true, analysis: null });
  store.put('assets', asset);
});
afterEach(() => { store.close(); rmSync(store.root, { recursive: true, force: true }); });

test('real local image preparation strips EXIF, rotates/resizes, and sends only ID-selected JPEG data URLs', async () => {
  const original = await sharp(store.path(asset.relativePath)).metadata();
  expect(original.exif).toBeDefined();
  const result = await send({ pageKey: 'photo', question: '观察这张图', assetIds: [asset.id] });
  expect(await result.text()).toContain('"status":"complete"');
  const payload = JSON.parse(request.mock.lastCall![1]!.body!);
  expect(payload.max_completion_tokens).toBe(1024);
  expect(payload).not.toHaveProperty('max_tokens');
  const content = payload.messages.at(-1).content;
  expect(content).toHaveLength(2);
  expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  const bytes = Buffer.from(content[1].image_url.url.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe('jpeg');
  expect(metadata.space).toBe('srgb');
  expect(metadata.width).toBe(800);
  expect(metadata.height).toBe(1600);
  expect(bytes.length).toBeLessThanOrEqual(2 * 1024 ** 2);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(JSON.stringify(payload)).not.toContain(asset.relativePath);
  expect(JSON.stringify(payload)).not.toContain('private metadata fixture');
  const user = store.list<ChatMessage>('messages').find(message => message.role === 'user')!;
  expect(user.snapshot!.assetIds).toEqual([asset.id]);
  expect(store.db.prepare('SELECT asset_id FROM message_assets WHERE message_id = ?').all(user.id)).toEqual([{ asset_id: asset.id }]);
  expect(() => store.remove('assets', asset.id)).toThrow();
  expect((await app.request(`/api/ai/conversations/${user.conversationId}?confirm=true`, { method: 'DELETE' })).status).toBe(200);
  expect(() => store.remove('assets', asset.id)).not.toThrow();
  expect(store.assetPins).toBe(0);
});

test('at most two image IDs can be selected; duplicates and arbitrary paths are rejected', async () => {
  const second = { ...asset, id: 'second-asset' }; store.put('assets', second);
  await (await send({ pageKey: 'two', question: '两张图', assetIds: [asset.id, second.id] })).text();
  const payload = JSON.parse(request.mock.lastCall![1]!.body!);
  expect(payload.messages.at(-1).content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(2);
  expect((await send({ pageKey: 'dup', question: '问', assetIds: [asset.id, asset.id] })).status).toBe(400);
  expect((await send({ pageKey: 'three', question: '问', assetIds: [asset.id, second.id, 'third'] })).status).toBe(400);
  expect((await send({ pageKey: 'path', question: '问', assetIds: ['/Users/private/picture.jpg'] })).status).toBe(404);
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([
  { kind: 'raw', mime: 'image/x-canon-cr2' }, { canAnalyze: false }, { rightsEvidence: '' },
])('RAW and unauthorized images do not leave the machine: %j', async changes => {
  store.put('assets', { ...asset, ...changes });
  const result = await send({ pageKey: 'blocked', question: '问', assetIds: [asset.id] });
  expect([400, 403]).toContain(result.status);
  expect(request).not.toHaveBeenCalled();
  expect(store.list('messages')).toEqual([]);
});

test('text-only configuration blocks image requests, but does not claim image verification', async () => {
  await configure(false);
  const result = await send({ pageKey: 'no-images', question: '问', assetIds: [asset.id] });
  expect((await result.json()).error.code).toBe('AI_IMAGE_UNSUPPORTED');
  expect(request).not.toHaveBeenCalled();
});

test('tampered asset paths fail safely with no upstream call and retain the selected attachment', async () => {
  store.put('assets', { ...asset, relativePath: '../private-secret.jpg' });
  const result = await send({ pageKey: 'tampered', question: '问', assetIds: [asset.id] });
  const text = await result.text();
  expect(text).toContain('AI_IMAGE_PREPARATION_FAILED');
  expect(text).not.toContain('private-secret');
  expect(request).not.toHaveBeenCalled();
  expect(store.list<ChatMessage>('messages').find(message => message.role === 'assistant')?.status).toBe('error');
  expect(store.list<ChatMessage>('messages').find(message => message.role === 'user')?.snapshot!.assetIds).toEqual([asset.id]);
});
