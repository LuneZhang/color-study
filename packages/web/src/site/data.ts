import tutorialsRaw from './data/tutorials.json';
import knowledgeRaw from './data/knowledge.json';
import discoverRaw from './data/discover.json';

export type Topic = 'landscape' | 'portrait' | 'general';
export type Quality = 'candidate' | 'recommended' | 'rejected';
export type RawStatus = 'none' | 'unverified' | 'paired';

export interface Tutorial {
  id: string; title: string; url: string; author: string; topic: Topic; tools: string[];
  language: string; software: string; version: string; level: 'beginner' | 'intermediate';
  access: 'free' | 'account' | 'paid'; summary: string; rawStatus: RawStatus; rawUrl: string;
  rawEvidence: string; rights: string; quality: Quality; reviewScope: 'metadata' | 'excerpt' | 'content';
  reviewSummary: string; reviewedAt: string;
}
export interface KnowledgeCard {
  id: string; title: string; subtitle: string; body: string; category: string; tools: string[];
  sources: { title: string; url: string }[]; relatedTutorialIds: string[];
}
export interface DiscoverItem {
  title: string; url: string; author: string; source: string; publishedAt: string; kind: 'photo' | 'practice';
}
export const tutorials = tutorialsRaw as unknown as Tutorial[];
export const knowledge = knowledgeRaw as unknown as KnowledgeCard[];
export const discover = discoverRaw as unknown as DiscoverItem[];

export const topicMeta: Record<Topic, { label: string; color: string; note: string }> = {
  landscape: { label: '风光', color: '#8caa94', note: '空间、光线与自然色彩' },
  portrait: { label: '人像', color: '#c0927f', note: '肤色、环境色与人物关系' },
  general: { label: '通用', color: '#97a1ad', note: '工具与判断的共同基础' },
};
export const qualityLabel: Record<Quality, string> = { recommended: '已审核', candidate: '候选', rejected: '不推荐' };
export const rawLabel: Record<RawStatus, string> = { paired: '有配套原片', unverified: '原片待核实', none: '仅教程' };
export const accessLabel = { free: '免费阅读', account: '需账户', paid: '付费' } as const;

export const formatDate = (value: string) => value
  ? new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
  : '日期未注明';
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '来源未注明'; } };
export const byId = (id: string) => tutorials.find(item => item.id === id);
export const featuredTutorial = tutorials.find(item => item.rawStatus === 'paired') ?? tutorials[0];
