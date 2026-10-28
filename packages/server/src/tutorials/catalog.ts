import { Hono } from 'hono';
import { tutorialInput, reviewInput, type Tutorial, type Asset, type QualityReview } from '@color-study/shared';
import { Store, entity } from '../db/store';
import { AppError, invariant, notFound } from '../errors';
import { canonicalUrl } from '../network';

function assertUnique(store: Store, url: string, exceptId?: string) {
  const row = store.db.prepare("SELECT id FROM tutorials WHERE json_extract(data,'$.url')=? AND id<>?").get(url, exceptId ?? '') as { id: string } | undefined;
  if (row) throw new AppError(409, 'DUPLICATE_URL', '已收录相同原始链接的教程，请直接打开已有记录。');
}

function checkMaterials(value: ReturnType<typeof tutorialInput.parse>) {
  if (value.rawStatus === 'paired') invariant(value.rawUrl && value.rawEvidence.trim() && value.rights.trim(), '标记配套原片需要下载地址、对应依据和使用许可');
  for (const section of value.sections) if (section.body.trim()) invariant(section.permission.trim(), '保存教程选段前请填写引用或持有依据');
}
export function createTutorialRouter(store: Store) {
  const app = new Hono();
  app.get('/', c => {
    const query = c.req.query();
    let items = store.list<Tutorial>('tutorials');
    for (const field of ['topic', 'level', 'language', 'software', 'access', 'quality', 'rawStatus'] as const) if (query[field]) items = items.filter(item => item[field] === query[field]);
    if (query.favorite === 'true') items = items.filter(item => item.favorite);
    if (query.tool) items = items.filter(item => item.tools.includes(query.tool));
    if (query.q) { const search = query.q.toLocaleLowerCase(); items = items.filter(item => [item.title, item.author, item.summary, ...item.tools].join(' ').toLocaleLowerCase().includes(search)); }
    const total = items.length;
    const offset = Math.max(0, Number(query.offset) || 0); const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    return c.json({ items: items.slice(offset, offset + limit), total });
  });
  app.post('/', async c => {
    const input = tutorialInput.parse(await c.req.json()); input.url = canonicalUrl(input.url); checkMaterials(input); assertUnique(store, input.url);
    const tutorial: Tutorial = { ...entity(input), quality: 'candidate', reviewScope: 'metadata', reviewSummary: '', reviewedAt: '', lastOpenedAt: '' };
    return c.json(store.put('tutorials', tutorial), 201);
  });
  app.get('/:id', c => {
    const tutorial = notFound(store.get<Tutorial>('tutorials', c.req.param('id')));
    const reviews = store.list<QualityReview>('reviews').filter(review => review.tutorialId === tutorial.id);
    const links = store.db.prepare('SELECT asset_id FROM tutorial_assets WHERE tutorial_id=?').all(tutorial.id) as { asset_id: string }[];
    const assets = links.map(link => store.get<Asset>('assets', link.asset_id)).filter(Boolean);
    return c.json({ tutorial, reviews, assets });
  });
  app.post('/:id/open', c => {
    const tutorial = notFound(store.get<Tutorial>('tutorials', c.req.param('id')));
    return c.json(store.put('tutorials', { ...tutorial, lastOpenedAt: new Date().toISOString() }));
  });
  app.patch('/:id', async c => {
    const previous = notFound(store.get<Tutorial>('tutorials', c.req.param('id')));
    const input = tutorialInput.partial().parse(await c.req.json());
    const next = { ...previous, ...input, updatedAt: new Date().toISOString() }; next.url = canonicalUrl(next.url); checkMaterials(next); assertUnique(store, next.url, previous.id);
    if (Object.keys(input).some(key => key !== 'favorite')) { next.quality = 'candidate'; next.reviewSummary = '资料已修改，需要重新审核'; }
    return c.json(store.put('tutorials', next));
  });
  app.post('/:id/reviews', async c => {
    const tutorial = notFound(store.get<Tutorial>('tutorials', c.req.param('id')));
    const input = reviewInput.parse(await c.req.json());
    if (input.verdict === 'recommended') invariant(input.scope === 'content', '仅凭元数据或选段不能直接推荐，请检查实际教学内容');
    const review: QualityReview = { ...entity(input), tutorialId: tutorial.id };
    store.db.transaction(() => {
      store.put('reviews', review);
      store.put('tutorials', { ...tutorial, quality: input.verdict, reviewScope: input.scope, reviewSummary: input.evidence, reviewedAt: review.createdAt, updatedAt: review.createdAt });
    })();
    return c.json(review, 201);
  });
  app.delete('/:id', c => {
    invariant(c.req.query('confirm') === 'true', '删除资料前需要确认');
    notFound(store.get('tutorials', c.req.param('id'))); store.remove('tutorials', c.req.param('id'));
    return c.json({ ok: true });
  });
  return app;
}
