import { Hono } from 'hono';
import type { Asset } from '../../../shared/src/media';
import type { Store } from '../db/store';
import { AppError, notFound } from '../errors';
import { deleteAsset, importAsset, linkAsset, linkInput } from './assets';
import { assertAvailable, fileResponse, managedPath } from './files';
export { makeAiImage } from './images';

export function createMediaRouter(store: Store): Hono {
  const router = new Hono();
  router.get('/', c => { const items = store.list<Asset>('assets'); return c.json({ items, total: items.length }); });
  router.post('/', async c => c.json(await importAsset(store, c.req.raw), 201));
  router.get('/:id', c => c.json(notFound(store.get<Asset>('assets', c.req.param('id')))));
  router.get('/:id/file', c => {
    assertAvailable(store);
    const asset = notFound(store.get<Asset>('assets', c.req.param('id')));
    const variant = c.req.query('variant') ?? 'original';
    if (!['original', 'preview', 'thumbnail'].includes(variant)) throw new AppError(400, 'INVALID_VARIANT', '无效的图片版本');
    if (variant !== 'original' && (!asset.canAnalyze || asset.kind !== 'image')) throw new AppError(403, 'IMAGE_NOT_ALLOWED', '未获准生成此派生图');
    const relative = variant === 'original' ? asset.relativePath : variant === 'preview' ? asset.previewPath : asset.thumbnailPath;
    const path = managedPath(store.dataDir, notFound(relative), variant === 'original' ? 'files' : 'derived');
    store.assetPins++;
    return fileResponse(path, variant === 'original' ? asset.mime : 'image/jpeg', variant === 'original' ? asset.name : undefined, () => { store.assetPins--; });
  });
  router.delete('/:id', c => { deleteAsset(store, c.req.param('id'), c.req.query('confirm') === 'true'); return c.json({ deleted: true }); });
  router.post('/:id/link', async c => {
    const parsed = linkInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(400, 'INVALID_LINK', '关联需要教程、角色和对应证据');
    linkAsset(store, c.req.param('id'), parsed.data);
    return c.json({ linked: true });
  });
  router.delete('/:id/link/:tutorialId', c => {
    assertAvailable(store); notFound(store.get('assets', c.req.param('id')));
    store.db.prepare('DELETE FROM tutorial_assets WHERE tutorial_id = ? AND asset_id = ?').run(c.req.param('tutorialId'), c.req.param('id'));
    return c.json({ unlinked: true });
  });
  return router;
}
