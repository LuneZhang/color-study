import { Hono } from 'hono';
import { z } from 'zod';
import { practiceInput, type Practice, type PracticeExport, type Asset } from '@color-study/shared';
import { Store, entity } from '../db/store';
import { invariant, notFound } from '../errors';
export function createPracticeRouter(store: Store) {
  const app = new Hono();
  function validate(input: ReturnType<typeof practiceInput.parse>) {
    if (input.tutorialId) notFound(store.get('tutorials', input.tutorialId));
    if (input.rawAssetId) notFound(store.get('assets', input.rawAssetId));
  }
  app.get('/', c => {
    const items = store.list<Practice>('practices').filter(item => !c.req.query('tutorialId') || item.tutorialId === c.req.query('tutorialId'));
    return c.json({ items, total: items.length });
  });
  app.post('/', async c => {
    const input = practiceInput.parse(await c.req.json()); validate(input);
    return c.json(store.put('practices', entity(input)), 201);
  });
  app.get('/:id', c => {
    const practice = notFound(store.get<Practice>('practices', c.req.param('id')));
    const exports = store.list<PracticeExport>('practice_exports').filter(item => item.practiceId === practice.id);
    const ids = new Set([...exports.map(item => item.assetId), practice.rawAssetId].filter(Boolean));
    const assets = store.list<Asset>('assets').filter(item => ids.has(item.id));
    return c.json({ practice, exports, assets });
  });
  app.patch('/:id', async c => {
    const previous = notFound(store.get<Practice>('practices', c.req.param('id')));
    const input = practiceInput.partial().parse(await c.req.json()); const value = { ...previous, ...input, updatedAt: new Date().toISOString() }; validate(value);
    return c.json(store.put('practices', value));
  });
  app.post('/:id/exports', async c => {
    notFound(store.get('practices', c.req.param('id')));
    const input = z.object({ assetId: z.string().max(100), note: z.string().max(3000).default('') }).parse(await c.req.json());
    const asset = notFound(store.get<Asset>('assets', input.assetId)); invariant(asset.kind === 'image', '练习导出版本需要 JPEG 或 PNG 图像');
    return c.json(store.put('practice_exports', { ...entity(input), practiceId: c.req.param('id') }), 201);
  });
  app.delete('/:id', c => {
    invariant(c.req.query('confirm') === 'true', '删除练习资料前需要确认');
    store.remove('practices', c.req.param('id')); return c.json({ ok: true });
  });
  return app;
}
