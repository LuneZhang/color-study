import { join } from 'node:path';
import { rename, rm } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { z } from 'zod';
import { assetMetaInput, type Asset } from '../../../shared/src/media';
import { entity, type Store } from '../db/store';
import { AppError, notFound } from '../errors';
import { receiveUpload } from './upload';
import { detectFormat, uploadLimit } from './formats';
import { deriveImage, inspectImage } from './images';
import { assertAvailable, managedPath } from './files';

export const linkInput = z.object({ tutorialId: z.string().trim().min(1).max(100), role: assetMetaInput.shape.role, evidence: z.string().trim().min(1).max(3000) });
export function linkAsset(store: Store, id: string, data: z.infer<typeof linkInput>) {
  assertAvailable(store);
  notFound(store.get('assets', id)); notFound(store.get('tutorials', data.tutorialId));
  store.db.prepare('INSERT INTO tutorial_assets(tutorial_id,asset_id,role,evidence) VALUES (?,?,?,?) ON CONFLICT(tutorial_id,asset_id) DO UPDATE SET role=excluded.role,evidence=excluded.evidence').run(data.tutorialId, id, data.role, data.evidence);
}
export async function importAsset(store: Store, request: Request): Promise<Asset> {
  assertAvailable(store);
  store.assetPins++;
  const cleanup: string[] = [];
  try {
    const upload = await receiveUpload(request, join(store.root, 'tmp'), uploadLimit);
    cleanup.push(upload.path);
    let rawMeta: unknown;
    try { rawMeta = JSON.parse(upload.fields.meta ?? 'null'); }
    catch { throw new AppError(400, 'INVALID_META', 'meta 必须是合法 JSON'); }
    const parsed = assetMetaInput.safeParse(rawMeta);
    if (!parsed.success) throw new AppError(400, 'INVALID_META', '必须提供有效的来源与许可证据');
    const meta = parsed.data;
    if (meta.tutorialId) {
      notFound(store.get('tutorials', meta.tutorialId));
      if (!meta.pairingEvidence.trim()) throw new AppError(400, 'PAIRING_EVIDENCE_REQUIRED', '关联教程必须提供对应依据');
    }
    const format = detectFormat(upload.name, upload.prefix);
    const identity = entity({});
    const relativePath = `files/${identity.id}${format.extension}`;
    const destination = store.path(relativePath);
    await rename(upload.path, destination); cleanup.push(destination);
    const dimensions = format.kind === 'image' ? await inspectImage(destination, format.mime) : { width: null, height: null };
    const canDerive = format.kind === 'image' && meta.canAnalyze;
    const previewPath = canDerive ? `derived/${identity.id}.preview.jpg` : null;
    const thumbnailPath = canDerive ? `derived/${identity.id}.thumbnail.jpg` : null;
    let analysis: Asset['analysis'] = null;
    if (previewPath && thumbnailPath) {
      cleanup.push(store.path(previewPath), store.path(thumbnailPath));
      analysis = await deriveImage(destination, store.path(previewPath), store.path(thumbnailPath));
    }
    const asset: Asset = { ...identity, name: upload.name, kind: format.kind, mime: format.mime, role: meta.role,
      size: upload.size, hash: upload.hash, relativePath, previewPath, thumbnailPath, ...dimensions,
      sourceUrl: meta.sourceUrl, rightsEvidence: meta.rightsEvidence, canAnalyze: meta.canAnalyze, owned: meta.owned, analysis };
    store.db.transaction(() => {
      store.put('assets', asset);
      if (meta.tutorialId) linkAsset(store, asset.id, { tutorialId: meta.tutorialId, role: meta.role, evidence: meta.pairingEvidence.trim() });
    })();
    cleanup.length = 0;
    return asset;
  } finally {
    await Promise.all(cleanup.map(path => rm(path, { force: true })));
    store.assetPins--;
  }
}
export function deleteAsset(store: Store, id: string, confirm: boolean) {
  assertAvailable(store);
  const asset = notFound(store.get<Asset>('assets', id));
  if (!confirm) throw new AppError(400, 'CONFIRM_REQUIRED', '删除托管文件需要明确确认');
  const references = [['tutorial_assets', 'asset_id'], ['library', 'thumbnail_asset_id'], ['practices', 'raw_asset_id'], ['practice_exports', 'asset_id'], ['message_assets', 'asset_id']];
  for (const [table, column] of references) {
    if (store.db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id)) throw new AppError(409, 'ASSET_REFERENCED', '此素材仍被教程、练习、作品或会话引用，请先解除关联');
  }
  if (store.assetPins) throw new AppError(409, 'ASSETS_PINNED', '文件正在使用或备份，请稍后删除');
  const paths = [asset.relativePath, asset.previewPath, asset.thumbnailPath].filter((path): path is string => !!path).map(path => managedPath(store.dataDir, path));
  const shared = store.list<Asset>('assets').some(other => other.id !== id && [other.relativePath, other.previewPath, other.thumbnailPath].some(path => !!path && [asset.relativePath, asset.previewPath, asset.thumbnailPath].includes(path)));
  if (shared) throw new AppError(409, 'ASSET_REFERENCED', '此文件仍被其他资产引用');
  store.remove('assets', id);
  for (const path of new Set(paths)) unlinkSync(path);
}
