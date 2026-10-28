import { Hono } from 'hono';
import { sourceInput, type Source } from '@color-study/shared';
import { Store, entity } from '../db/store';
import { invariant, notFound } from '../errors';
import { validateTarget } from '../network';
import { FeedService } from './service';
export function createSourceRouter(store: Store, service: FeedService) {
  const app = new Hono();
  app.get('/', c => { const items = store.list<Source>('sources'); return c.json({ items, total: items.length }); });
  app.post('/', async c => {
    const input = sourceInput.parse(await c.req.json()); await validateTarget(input.url);
    return c.json(store.put('sources', { ...entity(input), lastAttempt: '', lastSuccess: '', nextCheck: '', error: '', errorCount: 0, etag: '', lastModified: '' }), 201);
  });
  app.patch('/:id', async c => {
    const previous = notFound(store.get<Source>('sources', c.req.param('id')));
    const input = sourceInput.partial().parse(await c.req.json());
    if (input.url) await validateTarget(input.url);
    const changedUrl = input.url && input.url !== previous.url;
    return c.json(store.put('sources', { ...previous, ...input, updatedAt: new Date().toISOString(),
      ...(changedUrl ? { etag: '', lastModified: '', lastAttempt: '', lastSuccess: '', nextCheck: '', error: '', errorCount: 0 } : {}) }));
  });
  app.post('/:id/refresh', async c => c.json(await service.refresh(c.req.param('id'))));
  app.delete('/:id', c => {
    invariant(c.req.query('confirm') === 'true', '移除订阅前需要确认，已有收藏会保留');
    store.remove('sources', c.req.param('id')); return c.json({ ok: true });
  });
  return app;
}
