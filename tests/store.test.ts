import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, entity } from '../packages/server/src/db/store';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
test('persists documents and settings across restarts', () => {
  const root = mkdtempSync(join(tmpdir(), 'color-study-test-')); roots.push(root);
  let store = new Store(root);
  const tutorial = entity({ title: '曲线', url: 'https://example.org/tutorial', topic: 'general' });
  store.put('tutorials', tutorial); store.setSetting('probe', { enabled: true }); store.close();
  store = new Store(root);
  expect(store.get('tutorials', tutorial.id)).toEqual(tutorial);
  expect(store.setting('probe')).toEqual({ enabled: true });
  expect(() => store.path('../outside')).toThrow();
  expect(() => store.path('/etc/passwd')).toThrow();
  store.close();
});
test('unique canonical URLs and asset foreign keys are enforced', () => {
  const root = mkdtempSync(join(tmpdir(), 'color-study-test-')); roots.push(root);
  const store = new Store(root);
  const tutorial = entity({ url: 'https://example.org/a' }); store.put('tutorials', tutorial);
  expect(() => store.put('tutorials', entity({ url: tutorial.url }))).toThrow();
  expect(() => store.put('practices', entity({ tutorialId: tutorial.id, rawAssetId: 'missing' }))).toThrow();
  store.close();
});
