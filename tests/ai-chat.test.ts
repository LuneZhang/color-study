import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { Hono } from 'hono';
import { Store } from '../packages/server/src/db/store';
import { createAiRouter, type CredentialStore } from '../packages/server/src/ai';
import type { ChatMessage } from '../packages/shared/src/ai';
import type { safeRequest } from '../packages/server/src/network';

let store: Store;
let app: Hono;
const request = vi.fn<typeof safeRequest>();
const jsonRequest = (path: string, body: unknown, method = 'POST', signal?: AbortSignal) => app.request(`/api/ai${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});
const chunk = (text: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\r\n\r\n`;
function response(body: Readable, statusCode = 200) {
  return { body, statusCode, headers: { 'content-type': 'text/event-stream; charset=utf-8' } } as unknown as Awaited<ReturnType<typeof safeRequest>>;
}
const wire = (chunks: string[]) => Readable.from(chunks.map(text => Buffer.from(text)));
function success(text = '通用解释') { request.mockResolvedValue(response(wire([chunk(text), chunk('', 'stop'), 'data: [DONE]\n\n']))); }
function events(text: string) {
  return text.trim().split('\n\n').map(event => ({ event: event.split('\n')[0].slice(7), data: JSON.parse(event.split('\n')[1].slice(6)) }));
}
beforeEach(async () => {
  store = new Store(mkdtempSync(join(tmpdir(), 'color-ai-chat-')));
  const keys = new Map<string, string>();
  const credentials: CredentialStore = { get: async id => keys.get(id) ?? null, set: async (id, key) => { keys.set(id, key); }, delete: async id => { keys.delete(id); } };
  request.mockReset();
  app = new Hono().route('/api/ai', createAiRouter(store, { credentials, request }));
  await jsonRequest('/config', { baseUrl: 'https://example.org/v1', model: 'mock', key: 'not-a-real-key' }, 'PUT');
});
afterEach(() => { vi.useRealTimers(); store.close(); rmSync(store.root, { recursive: true, force: true }); });

test('POST SSE handles UTF-8 split across every byte, empty deltas and atomic snapshots', async () => {
  const upstream = Buffer.from(': heartbeat\r\n\r\ndata: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\r\n\r\n' + chunk('曲线🎨') + chunk('', 'stop'));
  request.mockResolvedValue(response(Readable.from([...upstream].map(byte => Buffer.from([byte])))));
  const res = await jsonRequest('/chat', { pageKey: 'tutorial:one', question: '曲线是什么？', tool: 'Camera Raw' });
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const output = events(await res.text());
  expect(output.map(item => item.event)).toEqual(['start', 'delta', 'done']);
  expect(output[1].data).toEqual({ text: '曲线🎨' });
  const { conversationId, requestId, messageId } = output[0].data;
  expect(output[2].data).toEqual({ status: 'complete', messageId });
  const messages = store.list<ChatMessage>('messages');
  expect(messages.every(message => message.conversationId === conversationId && message.requestId === requestId)).toBe(true);
  expect(messages.find(message => message.id === messageId)).toMatchObject({ content: '曲线🎨', status: 'complete' });
  expect(messages.find(message => message.role === 'user')?.snapshot).toEqual({ items: [], assetIds: [], tool: 'Camera Raw', historyIds: [], model: 'mock' });
  const payload = JSON.parse(request.mock.calls[0][1]!.body!);
  expect(payload).not.toHaveProperty('tools');
  expect(payload).not.toHaveProperty('temperature');
  expect(payload.max_tokens).toBe(1024);
  expect(payload.messages[0].content).toContain('不能编造或还原作者');
  expect(store.assetPins).toBe(0);
});

test('length finish is interrupted, while [DONE] without text is a valid empty completion', async () => {
  request.mockResolvedValueOnce(response(wire([chunk('未写完', 'length'), 'data: [DONE]\n\n'])));
  const output = events(await (await jsonRequest('/chat', { pageKey: 'a', question: '问' })).text());
  expect(output.at(-1)?.data.status).toBe('interrupted');
  expect(store.list<ChatMessage>('messages').find(message => message.role === 'assistant')?.status).toBe('interrupted');
  request.mockResolvedValueOnce(response(wire(['data: [DONE]\n\n'])));
  const empty = events(await (await jsonRequest('/chat', { pageKey: 'b', question: '问' })).text());
  expect(empty.map(item => item.event)).toEqual(['start', 'done']);
  expect(empty.at(-1)?.data.status).toBe('complete');
});

test('history is the last six rounds of this page only, and input cannot inject history IDs', async () => {
  success('其他页面的私密答案');
  await (await jsonRequest('/chat', { pageKey: 'other', question: '其他页面的私密问题' })).text();
  for (let index = 0; index < 7; index++) {
    success(`答案${index}`);
    await (await jsonRequest('/chat', { pageKey: 'current', question: `问题${index}` })).text();
  }
  success();
  await (await jsonRequest('/chat', { pageKey: 'current', question: '最后问题' })).text();
  const payload = JSON.parse(request.mock.lastCall![1]!.body!);
  expect(payload.messages).toHaveLength(14);
  expect(JSON.stringify(payload)).not.toContain('私密');
  expect(JSON.stringify(payload)).not.toContain('问题0');
  expect(payload.messages[1].content).toBe('问题1');
  const saved = store.list<ChatMessage>('messages').find(message => message.content === '最后问题')!;
  expect(saved.snapshot!.historyIds).toHaveLength(12);
  expect(saved.snapshot!.historyIds.every(id => store.get<ChatMessage>('messages', id)!.conversationId === saved.conversationId)).toBe(true);
  expect((await jsonRequest('/chat', { pageKey: 'current', question: 'x', historyIds: ['other'] })).status).toBe(400);
  const missing = await app.request('/api/ai/conversations?pageKey=missing');
  expect(await missing.json()).toEqual({ conversation: null, messages: [] });
});

test('reader cancellation aborts upstream and preserves partial content; another page stays isolated', async () => {
  const upstream = new PassThrough();
  request.mockResolvedValueOnce(response(upstream));
  const res = await jsonRequest('/chat', { pageKey: 'first', question: '第一问' });
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  const start = events(first)[0].data;
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  const signal = request.mock.calls[0][1]!.signal!;
  upstream.write(chunk('保留片段'));
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('保留片段');
  expect((await jsonRequest('/chat', { pageKey: 'first', question: '并发问' })).status).toBe(409);
  expect((await app.request(`/api/ai/conversations/${start.conversationId}?confirm=true`, { method: 'DELETE' })).status).toBe(409);
  success('另一个页面');
  await (await jsonRequest('/chat', { pageKey: 'second', question: '第二问' })).text();
  await reader.cancel();
  await vi.waitFor(() => expect(store.get<ChatMessage>('messages', start.messageId)?.status).toBe('interrupted'));
  expect(signal.aborted).toBe(true);
  expect(upstream.destroyed).toBe(true);
  expect(store.get<ChatMessage>('messages', start.messageId)?.content).toBe('保留片段');
  const second = await (await app.request('/api/ai/conversations?pageKey=second')).json();
  expect(second.messages.map((message: ChatMessage) => message.content)).toEqual(['第二问', '另一个页面']);
  success();
  const retry = await jsonRequest('/chat', { pageKey: 'first', question: '取消后重问' });
  expect(retry.status).toBe(200);
  await retry.text();
  expect(store.list<ChatMessage>('messages').some(message => message.status === 'pending')).toBe(false);
});

test.each([401, 429, 302, 400])('upstream %s produces sanitized SSE errors, never retries', async status => {
  const body = Readable.from(['not-a-real-key /Users/private https://private.example']);
  request.mockResolvedValue(response(body, status));
  const res = await jsonRequest('/chat', { pageKey: 'error', question: '问题保留' });
  const text = await res.text();
  expect(text).not.toMatch(/not-a-real-key|\/Users\/private|private\.example/);
  expect(events(text).map(item => item.event)).toEqual(['start', 'error', 'done']);
  expect(events(text).at(-1)?.data.status).toBe('interrupted');
  expect(store.list<ChatMessage>('messages').find(message => message.role === 'assistant')?.status).toBe('error');
  expect(store.list<ChatMessage>('messages').find(message => message.role === 'user')?.content).toBe('问题保留');
  expect(request).toHaveBeenCalledTimes(1);
  expect(body.destroyed).toBe(true);
});

test('truncated stream preserves text as error, not a successful answer; delete needs confirmation', async () => {
  request.mockResolvedValue(response(wire([chunk('部分回答')])));
  const output = events(await (await jsonRequest('/chat', { pageKey: 'truncated', question: '问题' })).text());
  expect(output.map(item => item.event)).toEqual(['start', 'delta', 'error', 'done']);
  const { conversationId, messageId } = output[0].data;
  expect(store.get<ChatMessage>('messages', messageId)).toMatchObject({ content: '部分回答', status: 'error' });
  expect((await app.request(`/api/ai/conversations/${conversationId}`, { method: 'DELETE' })).status).toBe(400);
  expect((await app.request(`/api/ai/conversations/${conversationId}?confirm=true`, { method: 'DELETE' })).status).toBe(200);
  expect(store.list('messages')).toEqual([]);
});
