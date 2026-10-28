import { randomUUID } from 'node:crypto';
import { AI_LIMITS, type ChatInput, type ChatMessage, type ContextItem, type ContextSnapshot, type Conversation } from '../../../shared/src/ai';
import { Store, entity } from '../db/store';
import { AiError } from './errors';

export function conversationForPage(store: Store, pageKey: string): Conversation | null {
  const row = store.db.prepare("SELECT data FROM conversations WHERE json_extract(data,'$.pageKey') = ?").get(pageKey) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
export function conversationMessages(store: Store, conversationId: string): ChatMessage[] {
  return (store.db.prepare('SELECT data FROM messages WHERE conversation_id = ? ORDER BY rowid').all(conversationId) as { data: string }[]).map(row => JSON.parse(row.data));
}
export function recentHistory(store: Store, conversation: Conversation | null): ChatMessage[] {
  if (!conversation) return [];
  const messages = conversationMessages(store, conversation.id);
  const rounds: ChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user') rounds.push([message]);
    else if (rounds.length && message.requestId === rounds.at(-1)![0].requestId && message.content && message.status !== 'pending') rounds.at(-1)!.push(message);
  }
  return rounds.slice(-AI_LIMITS.historyRounds).flat();
}
export function assertNotPending(store: Store, conversation: Conversation | null) {
  if (conversation && conversationMessages(store, conversation.id).some(message => message.status === 'pending')) {
    throw new AiError(409, 'AI_CONVERSATION_BUSY', '这个页面已有进行中的请求，请等待完成或取消后再发送。');
  }
}
export function beginTurn(store: Store, input: ChatInput, items: ContextItem[], history: ChatMessage[], model: string) {
  return store.db.transaction(() => {
    let conversation = conversationForPage(store, input.pageKey);
    assertNotPending(store, conversation);
    conversation ??= entity({ pageKey: input.pageKey, title: Array.from(input.question).slice(0, 80).join('') });
    store.put('conversations', { ...conversation, updatedAt: new Date().toISOString() });
    const requestId = randomUUID();
    const snapshot: ContextSnapshot = { items, assetIds: [...input.assetIds], tool: input.tool, historyIds: history.map(message => message.id), model };
    const user: ChatMessage = entity({ conversationId: conversation.id, role: 'user' as const, content: input.question, status: 'complete' as const, requestId, snapshot });
    const assistant: ChatMessage = entity({ conversationId: conversation.id, role: 'assistant' as const, content: '', status: 'pending' as const, requestId, snapshot: null });
    store.put('messages', user);
    store.put('messages', assistant);
    const link = store.db.prepare('INSERT INTO message_assets(message_id,asset_id) VALUES (?,?)');
    for (const assetId of snapshot.assetIds) link.run(user.id, assetId);
    return { conversation, user, assistant };
  })();
}
export function finishMessage(store: Store, message: ChatMessage, status: ChatMessage['status'], content: string) {
  // Both IDs must still match: never attach late output to a different request/page.
  const current = store.get<ChatMessage>('messages', message.id);
  if (!current || current.requestId !== message.requestId || current.status !== 'pending') return;
  store.put('messages', { ...current, status, content, updatedAt: new Date().toISOString() });
}
export function deleteConversation(store: Store, id: string) {
  const conversation = store.get<Conversation>('conversations', id);
  if (!conversation) throw new AiError(404, 'AI_CONVERSATION_NOT_FOUND', '会话不存在。');
  assertNotPending(store, conversation);
  store.remove('conversations', id);
}

/** Shared by router instances for this Store; also covers async keychain/image preparation. */
const locks = new WeakMap<Store, Set<string>>();
export function lockPage(store: Store, key: string) {
  const set = locks.get(store) ?? new Set<string>();
  locks.set(store, set);
  if (set.has(key)) throw new AiError(409, 'AI_PAGE_LOCKED', '这个页面正在结束上一条请求，请稍后重试。');
  set.add(key);
  return () => { set.delete(key); };
}
