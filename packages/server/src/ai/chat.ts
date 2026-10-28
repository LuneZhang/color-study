import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AI_LIMITS, chatInput, type ChatMessage } from '../../../shared/src/ai';
import type { Store } from '../db/store';
import type { safeRequest } from '../network';
import { activeProvider } from './config';
import type { CredentialStore } from './credentials';
import { checkContextBudget, contextPacket, validateAssets, validateItems } from './context';
import { assertNotPending, beginTurn, conversationForPage, finishMessage, lockPage, recentHistory } from './conversations';
import { AiError, publicAiError } from './errors';
import { prepareImages } from './images';
import { RequestLifetime } from './lifetime';
import { chatPayload, streamCompletion } from './upstream';

// Zod's string.max counts UTF-16 units; the approved budget counts Unicode code points.
const inputSchema = chatInput.extend({ question: z.string().trim().min(1).refine(text => Array.from(text).length <= AI_LIMITS.contextChars) }).strict();
export async function handleChat(c: Context, store: Store, credentials: CredentialStore, request: typeof safeRequest) {
  const input = inputSchema.parse(await c.req.json());
  const release = lockPage(store, input.pageKey);
  store.assetPins++;
  const unlock = () => { store.assetPins--; release(); };
  try {
    const session = await activeProvider(store, credentials);
    const conversation = conversationForPage(store, input.pageKey);
    assertNotPending(store, conversation);
    const items = validateItems(store, input.items);
    validateAssets(store, input.assetIds, session.config.imageSupport);
    const history = recentHistory(store, conversation);
    checkContextBudget(input, items, history);
    const turn = beginTurn(store, input, items, history, session.config.model);
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async stream => {
      const lifetime = new RequestLifetime();
      let content = '';
      let status: ChatMessage['status'] = 'interrupted';
      const cancel = () => lifetime.cancel();
      stream.onAbort(cancel);
      c.req.raw.signal.addEventListener('abort', cancel, { once: true });
      if (c.req.raw.signal.aborted || stream.aborted) cancel();
      const emit = (event: string, data: object) => stream.writeSSE({ event, data: JSON.stringify(data) });
      try {
        await lifetime.wait(emit('start', { conversationId: turn.conversation.id, requestId: turn.assistant.requestId, messageId: turn.assistant.id }));
        const images = await lifetime.wait(prepareImages(store, input.assetIds));
        const payload = chatPayload(session.config, history, contextPacket(input, items), images);
        for await (const delta of streamCompletion(session, payload, lifetime, request, images.length > 0)) {
          if (delta.text) {
            if (content.length + delta.text.length > 256 * 1024) throw new AiError(502, 'AI_OUTPUT_TOO_LARGE', '服务返回的内容超过安全上限，已中断请求。');
            content += delta.text;
            // Persist partial output so process interruption cannot erase text already shown.
            finishMessage(store, turn.assistant, 'pending', content);
            await lifetime.wait(emit('delta', { text: delta.text }));
          }
          if (delta.status) status = delta.status;
        }
        if (lifetime.signal.aborted) throw lifetime.signal.reason;
        finishMessage(store, turn.assistant, status, content);
        await lifetime.wait(emit('done', { status, messageId: turn.assistant.id }));
      } catch (error) {
        const safe = publicAiError(lifetime.signal.aborted ? lifetime.signal.reason : error);
        status = safe.code === 'AI_CANCELLED' ? 'interrupted' : 'error';
        finishMessage(store, turn.assistant, status, content);
        if (!stream.aborted && !c.req.raw.signal.aborted) {
          await emit('error', { code: safe.code, message: safe.message });
          await emit('done', { status: 'interrupted', messageId: turn.assistant.id });
        }
      } finally {
        lifetime.dispose();
        c.req.raw.signal.removeEventListener('abort', cancel);
        unlock();
      }
    });
  } catch (error) { unlock(); throw error; }
}
