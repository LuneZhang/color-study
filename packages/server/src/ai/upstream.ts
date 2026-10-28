import type { ChatMessage } from '../../../shared/src/ai';
import { safeRequest } from '../network';
import { providerTarget, type StoredProviderConfig } from './config';
import { SYSTEM_PROMPT } from './context';
import { protocolError, upstreamError } from './errors';
import { RequestLifetime } from './lifetime';
import { completionDelta, SseDecoder, type CompletionDelta } from './protocol';

type Transport = typeof safeRequest;
type ResponseBody = Awaited<ReturnType<Transport>>['body'];
export interface ProviderSession { config: StoredProviderConfig; key: string }
async function open(session: ProviderSession, payload: object, lifetime: RequestLifetime, request: Transport, images: boolean) {
  const target = providerTarget(session.config.baseUrl);
  lifetime.touch();
  const pending = request(target.url, {
    method: 'POST', allowLoopback: target.allowLoopback, timeout: 30_000, signal: lifetime.signal,
    headers: { Authorization: `Bearer ${session.key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(payload),
  });
  // A transport resolving after abort must not leave a socket/body open.
  void pending.then(response => { if (lifetime.signal.aborted) response.body.destroy(); }, () => {});
  const response = await lifetime.wait(pending);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.body.destroy();
    throw upstreamError(response.statusCode, images);
  }
  return response;
}
async function* bytes(body: ResponseBody, lifetime: RequestLifetime) {
  const iterator = body[Symbol.asyncIterator]();
  for (;;) {
    const chunk = await lifetime.wait(iterator.next());
    if (chunk.done) return;
    lifetime.touch();
    yield chunk.value as Uint8Array;
  }
}
export async function testConnection(session: ProviderSession, lifetime: RequestLifetime, request: Transport) {
  const response = await open(session, {
    model: session.config.model, stream: false,
    messages: [{ role: 'user', content: 'Reply OK.' }], [session.config.tokenParameter]: 1,
  }, lifetime, request, false);
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of bytes(response.body, lifetime)) {
      size += chunk.length;
      if (size > 64 * 1024) throw protocolError();
      chunks.push(Buffer.from(chunk));
    }
    let json;
    try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw protocolError(); }
    if (!Array.isArray(json?.choices) || typeof json.choices[0]?.message?.content !== 'string') throw protocolError();
  } finally { response.body.destroy(); }
}
export function chatPayload(config: StoredProviderConfig, history: ChatMessage[], packet: string, images: string[]) {
  const content = images.length ? [{ type: 'text', text: packet }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : packet;
  return {
    model: config.model, stream: true, [config.tokenParameter]: config.maxOutputTokens,
    messages: [{ role: 'system', content: SYSTEM_PROMPT },
      ...history.map(({ role, content }) => ({ role, content })), { role: 'user', content }],
  };
}
export async function* streamCompletion(session: ProviderSession, payload: object, lifetime: RequestLifetime, request: Transport, images: boolean): AsyncGenerator<CompletionDelta> {
  const response = await open(session, payload, lifetime, request, images);
  try {
    const contentType = response.headers['content-type'];
    if (typeof contentType !== 'string' || !/^text\/event-stream(?:;|$)/i.test(contentType)) throw protocolError();
    const decoder = new SseDecoder();
    for await (const chunk of bytes(response.body, lifetime)) {
      for (const data of decoder.push(chunk)) {
        const delta = completionDelta(data);
        yield delta;
        if (delta.status) return;
      }
    }
    for (const data of decoder.end()) {
      const delta = completionDelta(data);
      yield delta;
      if (delta.status) return;
    }
    throw protocolError(); // EOF without a finish reason or [DONE] is never success.
  } finally { response.body.destroy(); }
}
