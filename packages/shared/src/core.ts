import { z } from 'zod';
export const webUrl = z.string().max(2048).refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}, '请输入完整的 http(s) 地址');
export const optionalUrl = z.union([webUrl, z.literal('')]).default('');
export const topicSchema = z.enum(['landscape', 'portrait', 'general']);
export const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(16).default([]);
export interface Entity { id: string; createdAt: string; updatedAt: string }
export const topicLabels = { landscape: '风光旅行', portrait: '人像日常', general: '通用基础' } as const;
export type Topic = keyof typeof topicLabels;
export interface ApiError { error: { code: string; message: string; requestId?: string } }
