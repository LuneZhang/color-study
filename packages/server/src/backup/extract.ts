import { open, type ZipFile, type Entry } from 'yauzl';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { BACKUP_LIMITS, invalidBackup, requireSpace, validateEntryPath, type FileRecord } from './manifest';

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => open(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error) : resolve(zip)));
}
async function extractEntry(zip: ZipFile, entry: Entry, directory: string): Promise<FileRecord> {
  const input = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error) : resolve(stream)));
  let size = 0;
  const hash = createHash('sha256');
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > entry.uncompressedSize) { callback(new Error('ZIP expanded size mismatch')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(input, counter, createWriteStream(join(directory, entry.fileName), { flags: 'wx', mode: 0o600 }));
  if (size !== entry.uncompressedSize) invalidBackup('ZIP 文件展开大小不匹配');
  return { path: entry.fileName, size, sha256: hash.digest('hex') };
}
export async function extractZip(path: string, directory: string): Promise<FileRecord[]> {
  const zip = await openZip(path);
  const records: FileRecord[] = [];
  const seen = new Set<string>();
  let total = 0;
  try {
    if (zip.entryCount > BACKUP_LIMITS.entries + 1) invalidBackup('ZIP 文件数量超过上限');
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject); zip.once('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          validateEntryPath(entry.fileName);
          const canonical = entry.fileName.toLowerCase();
          if (seen.has(canonical)) invalidBackup('ZIP 包含重复路径');
          seen.add(canonical);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if ((mode && mode !== 0o100000) || (entry.generalPurposeBitFlag & 1) || (entry.externalFileAttributes & 0x10)) invalidBackup('ZIP 不允许符号链接、特殊文件、目录或加密项');
          const limit = entry.fileName === 'manifest.json' ? BACKUP_LIMITS.manifestBytes : BACKUP_LIMITS.fileBytes;
          total += entry.uncompressedSize;
          if (!Number.isSafeInteger(total) || entry.uncompressedSize > limit || total > BACKUP_LIMITS.expandedBytes) invalidBackup('ZIP 展开大小超过上限');
          await requireSpace(directory, entry.uncompressedSize);
          records.push(await extractEntry(zip, entry, directory));
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    return records;
  } finally { zip.close(); }
}
