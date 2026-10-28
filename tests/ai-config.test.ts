import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { Store } from '../packages/server/src/db/store';
import { createAiRouter, type CredentialStore } from '../packages/server/src/ai';
import type { safeRequest } from '../packages/server/src/network';

let store: Store;
let app: Hono;
let keys: Map<string, string>;
let credentials: CredentialStore;
const request = vi.fn<typeof safeRequest>();
const config = { name: '测试', baseUrl: 'https://example.org/v1', model: 'mock-model' };
const send = (path: string, method = 'GET', body?: unknown) => app.request(`/api/ai${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
beforeEach(() => {
  store = new Store(mkdtempSync(join(tmpdir(), 'color-ai-config-')));
  keys = new Map();
  credentials = { get: async id => keys.get(id) ?? null, set: async (id, key) => { keys.set(id, key); }, delete: async id => { keys.delete(id); } };
  request.mockReset();
  app = new Hono().route('/api/ai', createAiRouter(store, { credentials, request }));
});
afterEach(() => { store.close(); rmSync(store.root, { recursive: true, force: true }); });

test('configuration is local, optional and never returns or persists the secret', async () => {
  expect(await (await send('/config')).json()).toBeNull();
  const response = await send('/config', 'PUT', { ...config, key: 'fake-secret-for-tests' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...config, enabled: true, hasKey: true, imageSupport: false, maxOutputTokens: 1024, tokenParameter: 'max_tokens' });
  const saved = store.setting<{ keyRef: string }>('provider')!;
  expect(saved.keyRef).toMatch(/^provider-[0-9a-f-]{36}$/);
  expect(JSON.stringify(saved)).not.toContain('fake-secret-for-tests');
  expect(await (await send('/config')).text()).not.toContain(saved.keyRef);
  expect(request).not.toHaveBeenCalled();
  await send('/config', 'PUT', { ...config, model: 'new-model' });
  expect(keys.get(saved.keyRef)).toBe('fake-secret-for-tests');
  expect(await (await send('/config/key', 'DELETE')).json()).toEqual({ ok: true });
  expect(keys.size).toBe(0);
  expect((await (await send('/config')).json()).hasKey).toBe(false);
});

test.each([
  'http://example.org/v1', 'https://example.org/v1?key=x', 'https://example.org/v1?',
  'https://example.org/v1#x', 'https://a:b@example.org/v1', 'https://example.org/v1/chat/completions/',
  'https://example.org/v1/chat/%63ompletions', 'http://127.1/v1', 'http://2130706433/v1',
  'http://localhost.evil.org/v1', 'https://10.0.0.1/v1', 'http://[::ffff:127.0.0.1]/v1',
])('rejects unsafe API prefixes: %s', async baseUrl => {
  expect((await send('/config', 'PUT', { ...config, baseUrl, key: 'test-only' })).status).toBe(400);
  expect(keys.size).toBe(0);
  expect(request).not.toHaveBeenCalled();
});

test.each(['http://localhost:9911/v1', 'http://127.0.0.1:9911/v1', 'http://[::1]:9911/v1'])('accepts only explicit loopback HTTP: %s', async baseUrl => {
  expect((await send('/config', 'PUT', { ...config, baseUrl })).status).toBe(200);
});

test('keyring failure is explicit, sanitized and does not fall back to settings', async () => {
  credentials.set = async () => { throw new Error('fake-secret-for-tests /Users/private/keychain'); };
  const response = await send('/config', 'PUT', { ...config, key: 'fake-secret-for-tests' });
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).toContain('KEYCHAIN_UNAVAILABLE');
  expect(body).not.toContain('fake-secret-for-tests');
  expect(body).not.toContain('/Users/');
  expect(store.setting('provider')).toBeUndefined();
});

test('a changed provider origin cannot silently reuse the previous credential', async () => {
  await send('/config', 'PUT', { ...config, key: 'test-only' });
  expect((await send('/config', 'PUT', { ...config, baseUrl: 'https://other.example/v1' })).status).toBe(400);
  expect(request).not.toHaveBeenCalled();
});

test('only explicit test POST sends one minimal request and redacts provider failures', async () => {
  await send('/config', 'PUT', { ...config, key: 'test-only' });
  const destroy = vi.fn();
  request.mockResolvedValue({ statusCode: 401, headers: {}, body: { destroy } } as unknown as Awaited<ReturnType<typeof safeRequest>>);
  const response = await send('/config/test', 'POST', { page: 'must-not-be-sent' });
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe('AI_AUTH_FAILED');
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://example.org/v1/chat/completions');
  expect(JSON.parse(options!.body!)).toEqual({ model: 'mock-model', stream: false, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1 });
  expect(options!.allowLoopback).toBe(false);
  expect(destroy).toHaveBeenCalled();
  expect(store.list('messages')).toEqual([]);
});
