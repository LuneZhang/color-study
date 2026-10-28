import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { Store } from '../db/store';
import { safeRequest } from '../network';
import { activeProvider, deleteProviderKey, readStoredProvider, safeProvider, saveProvider, saveProviderInput } from './config';
import { KeychainCredentialStore, type CredentialStore } from './credentials';
import { conversationForPage, conversationMessages, deleteConversation } from './conversations';
import { handleChat } from './chat';
import { AiError, publicAiError } from './errors';
import { RequestLifetime } from './lifetime';
import { testConnection } from './upstream';

export { KEYRING_SERVICE, KeychainCredentialStore, type CredentialStore } from './credentials';
export { PROVIDER_SETTING, readStoredProvider, type StoredProviderConfig } from './config';
const configLocks = new WeakSet<Store>();

/** Mount with app.route('/api/ai', createAiRouter(store)); host/Origin/CSRF guards belong to the parent app. */
export function createAiRouter(store: Store, options: { credentials?: CredentialStore; request?: typeof safeRequest } = {}): Hono {
  const credentials = options.credentials ?? new KeychainCredentialStore();
  const request = options.request ?? safeRequest;
  const app = new Hono();
  app.onError((error, c) => {
    const safe = error instanceof ZodError || error instanceof SyntaxError
      ? new AiError(400, 'INVALID_INPUT', '请求格式或字段无效，请检查输入。') : publicAiError(error);
    return c.json({ error: { code: safe.code, message: safe.message } }, safe.status as ContentfulStatusCode);
  });
  app.use('*', async (c, next) => {
    if (store.maintenance) throw new AiError(503, 'MAINTENANCE', '正在恢复本地资料，请稍后再试。');
    await next();
  });
  const configMutation = async <T>(operation: () => Promise<T>) => {
    if (configLocks.has(store)) throw new AiError(409, 'AI_CONFIG_BUSY', '正在更新 AI 配置，请稍后重试。');
    configLocks.add(store); store.assetPins++;
    try { return await operation(); }
    finally { configLocks.delete(store); store.assetPins--; }
  };
  app.get('/config', async c => c.json(await safeProvider(readStoredProvider(store), credentials)));
  app.put('/config', async c => {
    const input = saveProviderInput.parse(await c.req.json());
    return c.json(await configMutation(() => saveProvider(store, credentials, input)));
  });
  app.delete('/config/key', async c => {
    await configMutation(() => deleteProviderKey(store, credentials));
    return c.json({ ok: true });
  });
  app.post('/config/test', async c => {
    // This route is never called by config GET/PUT or page navigation. It may incur one API charge.
    store.assetPins++;
    const lifetime = new RequestLifetime();
    const cancel = () => lifetime.cancel();
    c.req.raw.signal.addEventListener('abort', cancel, { once: true });
    if (c.req.raw.signal.aborted) cancel();
    try {
      const session = await lifetime.wait(activeProvider(store, credentials));
      await testConnection(session, lifetime, request);
      return c.json({ ok: true, imageSupportVerified: false });
    } finally { lifetime.dispose(); c.req.raw.signal.removeEventListener('abort', cancel); store.assetPins--; }
  });
  app.get('/conversations', c => {
    const pageKey = c.req.query('pageKey');
    if (!pageKey || pageKey.length > 300) throw new AiError(400, 'INVALID_INPUT', '请提供当前页面的 pageKey。');
    const conversation = conversationForPage(store, pageKey);
    return c.json({ conversation, messages: conversation ? conversationMessages(store, conversation.id) : [] });
  });
  app.delete('/conversations/:id', c => {
    if (c.req.query('confirm') !== 'true') throw new AiError(400, 'AI_CONFIRM_REQUIRED', '删除会话需要明确确认。');
    deleteConversation(store, c.req.param('id'));
    return c.json({ ok: true });
  });
  app.post('/chat', c => handleChat(c, store, credentials, request));
  return app;
}
