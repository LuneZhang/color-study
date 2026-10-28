import { z } from 'zod';
import { webUrl, optionalUrl, type Entity } from './core';
export const providerInput = z.object({
  name: z.string().max(100).default('我的 AI'), baseUrl: webUrl, model: z.string().trim().min(1).max(160),
  imageSupport: z.boolean().default(false), tokenParameter: z.enum(['max_tokens', 'max_completion_tokens']).default('max_tokens'),
  maxOutputTokens: z.number().int().min(64).max(4096).default(1024), enabled: z.boolean().default(true),
});
export type ProviderConfig = z.infer<typeof providerInput> & { hasKey: boolean };
export const contextItemSchema = z.object({
  id: z.string().min(1).max(120), type: z.enum(['page', 'tutorial', 'knowledge', 'selection', 'note']),
  entityId: z.string().max(100).optional(), title: z.string().max(240), text: z.string().max(24000),
  sourceUrl: optionalUrl, locator: z.string().max(200).default(''),
});
export type ContextItem = z.infer<typeof contextItemSchema>;
export const chatInput = z.object({
  pageKey: z.string().min(1).max(300), question: z.string().trim().min(1).max(12000),
  items: z.array(contextItemSchema).max(20).default([]), assetIds: z.array(z.string().max(100)).max(2).default([]),
  tool: z.string().max(200).default(''),
});
export type ChatInput = z.infer<typeof chatInput>;
export interface Conversation extends Entity { pageKey: string; title: string }
export interface ContextSnapshot { items: ContextItem[]; assetIds: string[]; tool: string; historyIds: string[]; model: string }
export interface ChatMessage extends Entity {
  conversationId: string; role: 'user' | 'assistant'; content: string;
  status: 'pending' | 'complete' | 'interrupted' | 'error'; requestId: string; snapshot: ContextSnapshot | null;
}
export const AI_LIMITS = { contextChars: 12000, historyRounds: 6, images: 2, imageBytes: 2 * 1024 ** 2, imageEdge: 1600 };
