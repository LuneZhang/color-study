import { extname } from 'node:path';
import { MEDIA_LIMITS } from '../../../shared/src/media';
import { AppError } from '../errors';

const rawExtensions = new Set(['.dng', '.nef', '.nrw', '.arw', '.sr2', '.srf', '.cr2', '.cr3', '.crw', '.orf', '.rw2', '.raf', '.pef', '.srw', '.raw', '.rwl', '.3fr', '.fff', '.iiq', '.mos', '.kdc', '.dcr', '.mrw', '.x3f']);
const images = new Set(['.jpg', '.jpeg', '.png']);
export function uploadLimit(name: string) {
  const extension = extname(name).toLowerCase();
  if (rawExtensions.has(extension)) return MEDIA_LIMITS.rawBytes;
  if (images.has(extension)) return MEDIA_LIMITS.imageBytes;
  throw new AppError(415, 'UNSUPPORTED_MEDIA', '仅支持 JPEG、PNG 和常见相机 RAW 文件');
}
export function detectFormat(name: string, bytes: Buffer) {
  const extension = extname(name).toLowerCase();
  const starts = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (['.jpg', '.jpeg'].includes(extension) && starts('ffd8ff')) return { kind: 'image' as const, mime: 'image/jpeg', extension: '.jpg' };
  if (extension === '.png' && starts('89504e470d0a1a0a')) return { kind: 'image' as const, mime: 'image/png', extension };
  const tiff = starts('49492a00') || starts('4d4d002a');
  const isRaw = rawExtensions.has(extension) && (
    (extension === '.cr2' ? tiff && bytes.subarray(8, 12).equals(Buffer.from('43520200', 'hex')) :
    extension === '.cr3' ? bytes.subarray(4, 8).toString() === 'ftyp' && bytes.subarray(8, 12).toString() === 'crx ' :
    extension === '.crw' ? bytes.subarray(0, 14).equals(Buffer.from('49491a0000004845415043434452', 'hex')) :
    extension === '.raf' ? bytes.subarray(0, 16).toString() === 'FUJIFILMCCD-RAW ' :
    extension === '.orf' ? starts('4949524f') || starts('49495352') || starts('4d4d4f52') :
    extension === '.rw2' ? starts('49495500') :
    extension === '.mrw' ? starts('004d524d') :
    extension === '.x3f' ? bytes.subarray(0, 4).toString() === 'FOVb' : tiff)
  );
  if (isRaw) return { kind: 'raw' as const, mime: 'application/octet-stream', extension };
  throw new AppError(415, 'INVALID_SIGNATURE', '文件签名与扩展名不符，或不是支持的图像/RAW');
}
