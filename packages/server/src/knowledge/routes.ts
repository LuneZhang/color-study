import { Hono } from 'hono';
import type { KnowledgeCard } from '@color-study/shared';
import type { Store } from '../db/store';
import { notFound } from '../errors';
export function createKnowledgeRouter(store: Store) {
  const app = new Hono();
  app.get('/', c => {
    const query = c.req.query(); let items = store.list<KnowledgeCard>('knowledge');
    if (query.category) items = items.filter(item => item.category === query.category);
    if (query.q) { const search = query.q.toLowerCase(); items = items.filter(item => [item.title, item.subtitle, item.body, ...item.tools].join(' ').toLowerCase().includes(search)); }
    return c.json({ items, total: items.length });
  });
  app.get('/:id', c => c.json(notFound(store.get<KnowledgeCard>('knowledge', c.req.param('id')))));
  return app;
}
