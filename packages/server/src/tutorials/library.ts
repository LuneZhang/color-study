import { Hono } from 'hono';
import { libraryInput, type LibraryItem, type Tutorial, type Asset } from '@color-study/shared';
import { Store, entity } from '../db/store';
import { canonicalUrl } from '../network';
import { AppError, invariant, notFound } from '../errors';

function assertUnique(store: Store, url: string, exceptId?: string) {
  const row = store.db.prepare("SELECT id FROM library WHERE json_extract(data,'$.url')=? AND id<>?").get(url, exceptId ?? '') as { id: string } | undefined;
  if (row) throw new AppError(409, 'DUPLICATE_URL', '作品库里已有相同原始链接的条目。');
}
export function createLibraryRouter(store: Store) {
  const app = new Hono();
  const save = (item: LibraryItem) => store.db.transaction(() => {
    assertUnique(store, item.url, item.id);
    for (const id of item.tutorialIds) notFound(store.get<Tutorial>('tutorials', id));
    if (item.thumbnailAssetId) {
      const asset = notFound(store.get<Asset>('assets', item.thumbnailAssetId));
      invariant(asset.canAnalyze && asset.thumbnailPath, '该素材没有获准生成缩略图');
    }
    store.put('library', item);
    store.db.prepare('DELETE FROM library_tutorials WHERE item_id=?').run(item.id);
    for (const id of new Set(item.tutorialIds)) store.db.prepare('INSERT INTO library_tutorials(item_id,tutorial_id) VALUES (?,?)').run(item.id, id);
    return item;
  })();
  app.get('/', c => {
    const query = c.req.query(); let items = store.list<LibraryItem>('library');
    const origin = query.origin === 'feed' ? 'feed' : 'manual';
    items = items.filter(item => (item.origin ?? 'manual') === origin);
    if (query.favorite === 'true') items = items.filter(item => item.favorite);
    if (query.topic) items = items.filter(item => item.topic === query.topic);
    if (query.q) items = items.filter(item => [item.title, item.author, item.summary, ...item.tags].join(' ').toLowerCase().includes(query.q.toLowerCase()));
    if (query.sourceId) {
      const ids = new Set((store.db.prepare('SELECT item_id FROM source_entries WHERE source_id=?').all(query.sourceId) as { item_id: string }[]).map(row => row.item_id));
      items = items.filter(item => ids.has(item.id));
    }
    items.sort((a, b) => origin === 'feed'
      ? (b.publishedAt || '').localeCompare(a.publishedAt || '') || b.createdAt.localeCompare(a.createdAt)
      : b.updatedAt.localeCompare(a.updatedAt));
    const offset = Math.max(0, Number(query.offset) || 0); const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    return c.json({ items: items.slice(offset, offset + limit), total: items.length });
  });
  app.get('/:id', c => c.json(notFound(store.get<LibraryItem>('library', c.req.param('id')))));
  app.post('/', async c => {
    const input = libraryInput.parse(await c.req.json()); input.url = canonicalUrl(input.url);
    return c.json(save(entity(input)), 201);
  });
  app.patch('/:id', async c => {
    const previous = notFound(store.get<LibraryItem>('library', c.req.param('id')));
    const input = libraryInput.partial().parse(await c.req.json());
    return c.json(save({ ...previous, ...input, url: canonicalUrl(input.url ?? previous.url), updatedAt: new Date().toISOString() }));
  });
  app.delete('/:id', c => {
    invariant(c.req.query('confirm') === 'true', '删除收藏前需要确认');
    store.remove('library', c.req.param('id')); return c.json({ ok: true });
  });
  return app;
}
