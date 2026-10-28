import { expect, test } from 'vitest';
import tutorials from '../packages/web/src/site/data/tutorials.json';
import knowledge from '../packages/web/src/site/data/knowledge.json';
import discover from '../packages/web/src/site/data/discover.json';

test('static learning data keeps the intended coverage and traceable sources', () => {
  expect(tutorials).toHaveLength(8);
  expect(new Set(tutorials.map(item => item.url)).size).toBe(8);
  expect(tutorials.filter(item => item.rawStatus === 'paired')).toHaveLength(3);
  expect(tutorials.filter(item => item.topic === 'landscape')).toHaveLength(3);
  expect(tutorials.filter(item => item.topic === 'portrait')).toHaveLength(3);
  expect(tutorials.every(item => /^https:\/\//.test(item.url) && item.reviewedAt && item.quality === 'recommended')).toBe(true);
  expect(knowledge).toHaveLength(12);
  expect(knowledge.every(item => item.sources.length > 0 && item.sources.every(source => /^https:\/\//.test(source.url)))).toBe(true);
  expect(discover.length).toBeGreaterThanOrEqual(8);
  expect(discover.every(item => /^https?:\/\//.test(item.url) && item.title && item.source)).toBe(true);
});
