import sharp from 'sharp';
import { MEDIA_LIMITS, type Asset } from '../../../shared/src/media';
import type { Store } from '../db/store';
import { AppError, notFound } from '../errors';
import { ANALYSIS_PARAMETERS, analyzePixels } from './analysis';
import { assertAvailable, managedPath } from './files';

const input = (path: string) => sharp(path, { limitInputPixels: MEDIA_LIMITS.pixels, failOn: 'warning', sequentialRead: true });
export async function inspectImage(path: string, mime: string) {
  try {
    const metadata = await input(path).metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || `image/${metadata.format}` !== mime) throw new Error('Invalid image');
    if (metadata.width * metadata.height > MEDIA_LIMITS.pixels) throw new AppError(413, 'PIXEL_LIMIT', '图片超过一亿像素');
    await input(path).resize(1, 1, { fit: 'inside' }).toBuffer();
    const swap = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    return { width: swap ? metadata.height : metadata.width, height: swap ? metadata.width : metadata.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (/pixel limit/i.test(String(error))) throw new AppError(413, 'PIXEL_LIMIT', '图片超过一亿像素');
    throw new AppError(400, 'INVALID_IMAGE', '图片损坏、为多帧图像或无法解码');
  }
}
export async function deriveImage(path: string, preview: string, thumbnail: string) {
  try {
    const base = () => input(path).rotate().toColourspace('srgb');
    for (const [size, destination] of [[ANALYSIS_PARAMETERS.previewEdge, preview], [ANALYSIS_PARAMETERS.thumbnailEdge, thumbnail]] as const) {
      await base().resize(size, size, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toFile(destination);
    }
    const rgba = await base().resize(ANALYSIS_PARAMETERS.sampleEdge, ANALYSIS_PARAMETERS.sampleEdge, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer();
    return analyzePixels(rgba);
  } catch { throw new AppError(400, 'IMAGE_PROCESSING_FAILED', '图片无法转换为 sRGB 派生图'); }
}
export async function makeAiImage(store: Store, assetId: string): Promise<string> {
  assertAvailable(store);
  const asset = notFound(store.get<Asset>('assets', assetId));
  if (asset.kind !== 'image' || !asset.canAnalyze) throw new AppError(403, 'IMAGE_NOT_ALLOWED', 'RAW 或未获处理许可的图片不能发送给 AI');
  store.assetPins++;
  try {
    const path = managedPath(store.dataDir, asset.relativePath, 'files');
    for (const size of [1600, 1280, 1024, 800]) {
      const data = await input(path).rotate().toColourspace('srgb').resize(size, size, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
      if (data.length <= 2 * 1024 ** 2) return `data:image/jpeg;base64,${data.toString('base64')}`;
    }
    throw new AppError(413, 'AI_IMAGE_TOO_LARGE', 'AI 图片无法满足 2 MiB 上限');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_IMAGE', '图片损坏或不可读取');
  } finally { store.assetPins--; }
}
