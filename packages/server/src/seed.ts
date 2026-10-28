import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KnowledgeCard, Source, Tutorial, QualityReview } from '@color-study/shared';
import { Store, entity } from './db/store';
import { canonicalUrl } from './network';

const SEED_VERSION = 1;
const seedDir = fileURLToPath(new URL('../../../content/seed/', import.meta.url));
function read<T>(name: string): T[] { const path = join(seedDir, name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T[] : []; }

export function seedIfNeeded(store: Store) {
  if (store.setting<number>('seedVersion')) return { seeded: false, tutorials: 0 };
  const now = new Date().toISOString();
  const tutorials = read<Tutorial & { reviewEvidence: string }>('tutorials.json');
  const knowledge = read<Omit<KnowledgeCard, 'id' | 'createdAt' | 'updatedAt'>>('knowledge.json');
  const sources = read<Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'lastAttempt' | 'lastSuccess' | 'nextCheck' | 'error' | 'errorCount' | 'etag' | 'lastModified'>>('sources.json');
  store.db.transaction(() => {
    for (const item of tutorials) {
      const url = canonicalUrl(item.url);
      const exists = store.db.prepare("SELECT id FROM tutorials WHERE json_extract(data,'$.url')=?").get(url);
      if (!exists) {
        const { reviewEvidence, ...fields } = item;
        const tutorial: Tutorial = { ...fields, id: randomUUID(), url, createdAt: now, updatedAt: now, favorite: false };
        store.put('tutorials', tutorial);
        store.put('reviews', { id: randomUUID(), tutorialId: tutorial.id, createdAt: now, updatedAt: now, reviewer: 'assistant',
          scope: tutorial.reviewScope, verdict: tutorial.quality, evidence: reviewEvidence,
          checks: { 来源可信: 'pass', 教学实质: 'pass', 原理与取舍: 'pass', 过程连贯: 'partial', 素材对应: tutorial.rawStatus === 'paired' ? 'pass' : 'unknown', 适用条件: 'pass' } } satisfies QualityReview);
      }
    }
    for (const item of knowledge) {
      const card: KnowledgeCard = { ...item, id: randomUUID(), createdAt: now, updatedAt: now };
      store.put('knowledge', card);
    }
    for (const item of sources) {
      store.put('sources', { ...item, id: randomUUID(), createdAt: now, updatedAt: now, lastAttempt: '', lastSuccess: '', nextCheck: '', error: '', errorCount: 0, etag: '', lastModified: '' });
    }
    store.setSetting('seedVersion', SEED_VERSION);
  })();
  return { seeded: true, tutorials: tutorials.length };
}
