import { createReadStream } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SCHEMA_VERSION } from '../db/schema';
import { AppError } from '../errors';

export const BACKUP_LIMITS = { archiveBytes: 20 * 1024 ** 3, expandedBytes: 100 * 1024 ** 3, fileBytes: 2 * 1024 ** 3, manifestBytes: 16 * 1024 ** 2, entries: 100_000, reserveBytes: 16 * 1024 ** 2 };
export const manifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION), createdAt: z.iso.datetime(), knowledgeVersion: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({ path: z.string().max(255), size: z.number().int().nonnegative().max(BACKUP_LIMITS.fileBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(BACKUP_LIMITS.entries),
}).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export type FileRecord = Manifest['files'][number];
export function invalidBackup(message: string): never { throw new AppError(400, 'INVALID_BACKUP', message); }
export function validateEntryPath(path: string) {
  if (path === 'db.sqlite' || path === 'manifest.json') return;
  if (!/^(files|derived)\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,220}$/.test(path)) invalidBackup('ZIP 包含非法或非托管文件路径');
}
export async function digestFile(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(path)) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest('hex') };
}
type SpaceProbe = (path: string) => Promise<{ bavail: bigint; bsize: bigint }>;
const realSpaceProbe: SpaceProbe = async path => statfs(path, { bigint: true });
let spaceProbe: SpaceProbe = realSpaceProbe;
/** Test seam: disk-full behaviour must be exercised without filling the real volume. */
export function setSpaceProbeForTests(probe: SpaceProbe | null) { spaceProbe = probe ?? realSpaceProbe; }
export async function requireSpace(directory: string, size: number) {
  const disk = await spaceProbe(directory);
  if (disk.bavail * disk.bsize < BigInt(size + BACKUP_LIMITS.reserveBytes)) throw new AppError(507, 'INSUFFICIENT_SPACE', '磁盘可用空间不足，现有资料库未改变');
}
