import { z } from 'zod';
import { optionalUrl, tagsSchema, topicSchema, webUrl, type Entity } from './core';
export const sectionSchema = z.object({
  id: z.string().max(100), title: z.string().max(200), locator: z.string().max(200).default(''),
  body: z.string().max(24000).default(''), sourceUrl: optionalUrl, permission: z.string().max(2000).default(''),
});
export const tutorialInput = z.object({
  title: z.string().trim().min(1).max(240), url: webUrl, author: z.string().max(160).default(''),
  topic: topicSchema.default('general'), tools: tagsSchema, language: z.string().max(40).default('英文'),
  software: z.string().max(100).default('Camera Raw'), version: z.string().max(100).default(''),
  level: z.enum(['beginner', 'intermediate']).default('beginner'), access: z.enum(['free', 'account', 'paid']).default('free'),
  summary: z.string().max(5000).default(''), rawStatus: z.enum(['none', 'unverified', 'paired']).default('none'),
  rawUrl: optionalUrl, rawEvidence: z.string().max(3000).default(''), rights: z.string().max(3000).default(''),
  sections: z.array(sectionSchema).max(100).default([]), favorite: z.boolean().default(false),
  publishedAt: z.string().max(40).default(''), duration: z.string().max(40).default(''),
});
export type Tutorial = z.infer<typeof tutorialInput> & Entity & {
  quality: 'candidate' | 'recommended' | 'rejected'; reviewScope: 'metadata' | 'excerpt' | 'content';
  reviewSummary: string; reviewedAt: string; lastOpenedAt: string;
};
export const reviewInput = z.object({
  scope: z.enum(['metadata', 'excerpt', 'content']), verdict: z.enum(['candidate', 'recommended', 'rejected']),
  evidence: z.string().trim().min(10).max(5000), checks: z.record(z.string().max(60), z.enum(['pass', 'partial', 'unknown'])).default({}),
  reviewer: z.enum(['user', 'assistant']).default('user'),
});
export type QualityReview = z.infer<typeof reviewInput> & Entity & { tutorialId: string };
export const libraryInput = z.object({
  title: z.string().trim().min(1).max(300), url: webUrl, author: z.string().max(160).default(''),
  topic: topicSchema.default('general'), tags: tagsSchema, summary: z.string().max(5000).default(''),
  favorite: z.boolean().default(false), tutorialIds: z.array(z.string().max(100)).max(30).default([]),
  thumbnailAssetId: z.string().max(100).nullable().default(null), publishedAt: z.string().max(50).default(''),
  origin: z.enum(['manual', 'feed']).default('manual'),
});
export type LibraryItem = z.infer<typeof libraryInput> & Entity;
export const sourceInput = z.object({
  name: z.string().trim().min(1).max(160), url: webUrl, siteUrl: optionalUrl,
  enabled: z.boolean().default(true), rights: z.string().max(3000).default('仅元信息，图片权利未确认'),
});
export type Source = z.infer<typeof sourceInput> & Entity & {
  lastAttempt: string; lastSuccess: string; nextCheck: string; error: string; errorCount: number; etag: string; lastModified: string;
};
export interface KnowledgeCard extends Entity {
  title: string; subtitle: string; body: string; category: string; tools: string[];
  sources: { title: string; url: string }[]; relatedTutorialIds: string[];
}
export const practiceInput = z.object({
  title: z.string().trim().min(1).max(200), tutorialId: z.string().max(100).nullable().default(null),
  rawAssetId: z.string().max(100).nullable().default(null), note: z.string().max(30000).default(''),
  status: z.enum(['active', 'complete']).default('active'),
});
export type Practice = z.infer<typeof practiceInput> & Entity;
export interface PracticeExport extends Entity { practiceId: string; assetId: string; note: string }
