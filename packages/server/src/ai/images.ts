import { AI_LIMITS } from '../../../shared/src/ai';
import type { Store } from '../db/store';
import { AiError } from './errors';

/** The media boundary resolves IDs, checks rights, and creates stripped sRGB JPEGs. */
export async function prepareImages(store: Store, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  try {
    const { makeAiImage } = await import('../media/ai-image');
    const images: string[] = [];
    for (const id of ids) {
      const image = await makeAiImage(store, id);
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image) ||
        Buffer.byteLength(image.slice(image.indexOf(',') + 1), 'base64') > AI_LIMITS.imageBytes) throw new Error('Invalid AI derivative');
      images.push(image);
    }
    return images;
  } catch {
    throw new AiError(400, 'AI_IMAGE_PREPARATION_FAILED', '无法生成获准的 JPEG 派生图，请检查图片、处理权限与文件是否完整。');
  }
}
