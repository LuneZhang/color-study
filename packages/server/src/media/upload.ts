import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors';

export interface Upload {
  path: string; name: string; size: number; hash: string; prefix: Buffer; fields: Record<string, string>;
}
export async function receiveUpload(request: Request, directory: string, limit: (name: string) => number): Promise<Upload> {
  if (!request.body) throw new AppError(400, 'INVALID_UPLOAD', '请选择文件');
  const path = join(directory, `upload-${randomUUID()}`);
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({ headers: { 'content-type': request.headers.get('content-type') ?? '' },
      limits: { files: 1, fields: 2, parts: 3, fieldSize: 16 * 1024, fieldNameSize: 100 } });
  } catch { throw new AppError(400, 'INVALID_UPLOAD', '需要 multipart 文件上传'); }
  const fields: Record<string, string> = Object.create(null);
  const hash = createHash('sha256');
  let name = '', size = 0, prefix = Buffer.alloc(0), received = false;
  let failure: Error | undefined;
  const writes: Promise<void>[] = [];
  const fail = (error: Error) => { failure ??= error; parser.destroy(error); };
  parser.on('file', (field, file, info) => {
    file.on('error', error => { failure ??= error; });
    if (field !== 'file' || !info.filename || received) {
      file.resume(); fail(new AppError(400, 'INVALID_UPLOAD', '只允许一个 file 文件')); return;
    }
    received = true;
    name = info.filename.normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240);
    let maximum: number;
    try { maximum = limit(name); } catch (error) { file.resume(); fail(error as Error); return; }
    const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maximum) { callback(new AppError(413, 'FILE_TOO_LARGE', '文件超过大小上限')); return; }
      if (prefix.length < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.length)]);
      hash.update(chunk);
      callback(null, chunk);
    } });
    writes.push(pipeline(file, counter, createWriteStream(path, { flags: 'wx', mode: 0o600 })).catch(fail));
  });
  parser.on('field', (field, value, info) => {
    if (info.valueTruncated || info.nameTruncated || Object.hasOwn(fields, field)) {
      fail(new AppError(400, 'INVALID_UPLOAD', '上传元信息过大或重复')); return;
    }
    fields[field] = value;
  });
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) {
    parser.on(event, () => fail(new AppError(400, 'INVALID_UPLOAD', '上传字段过多')));
  }
  try {
    const body = request.body as import('node:stream/web').ReadableStream<Uint8Array>;
    await pipeline(Readable.from(body.values({ preventCancel: true })), parser);
    await Promise.all(writes);
    if (failure) throw failure;
    if (!received || !size) throw new AppError(400, 'INVALID_UPLOAD', '上传文件为空');
    return { path, name, size, prefix, hash: hash.digest('hex'), fields };
  } catch (error) {
    await Promise.all(writes);
    await rm(path, { force: true });
    if (failure instanceof AppError) throw failure;
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_UPLOAD', '上传中断或文件格式不正确');
  }
}
