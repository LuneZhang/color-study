import { lstatSync, createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Store } from '../db/store';
import { AppError } from '../errors';

export function managedPath(directory: string, relative: string, area?: 'files' | 'derived') {
  if (typeof relative !== 'string' || !/^(files|derived)\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(relative) || (area && !relative.startsWith(area + '/'))) {
    throw new AppError(400, 'INVALID_PATH', '资产路径不在托管目录内');
  }
  const path = resolve(directory, relative);
  if (lstatSync(directory).isSymbolicLink() || lstatSync(dirname(path)).isSymbolicLink()) throw new AppError(400, 'INVALID_PATH', '不允许符号链接');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError(400, 'INVALID_PATH', '资产不是普通托管文件');
  return path;
}
export function assertAvailable(store: Store) {
  if (store.maintenance) throw new AppError(503, 'MAINTENANCE', '资料库正在恢复，请稍后重试');
}
export function fileResponse(path: string, mime: string, name?: string, release?: () => void) {
  const stream = createReadStream(path);
  stream.once('close', () => release?.());
  const headers = new Headers({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  if (name) headers.set('Content-Disposition', `attachment; filename="download${join('', name).endsWith('.zip') ? '.zip' : ''}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
}
