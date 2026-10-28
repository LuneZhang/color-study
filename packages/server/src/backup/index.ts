import { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from '../db/store';
import { AppError } from '../errors';
import { fileResponse } from '../media/files';
import { backupInfo, backupPath, createBackup, listBackups } from './snapshot';
import { RestoreManager } from './restore';

export function createBackupRouter(store: Store): Hono {
  const router = new Hono();
  const restores = new RestoreManager(store);
  router.get('/', async c => c.json({ items: await listBackups(store) }));
  router.post('/', async c => c.json(await createBackup(store), 201));
  router.get('/:id/download', async c => {
    const info = await backupInfo(store, c.req.param('id'));
    return fileResponse(backupPath(store, info.id), 'application/zip', info.name);
  });
  router.post('/validate', async c => c.json(await restores.validate(c.req.raw)));
  router.post('/restore', async c => {
    const data = z.object({ id: z.string().uuid(), confirm: z.literal(true) }).safeParse(await c.req.json().catch(() => null));
    if (!data.success) throw new AppError(400, 'INVALID_RESTORE', '请提供已校验的备份 ID 并确认恢复');
    return c.json(await restores.restore(data.data.id, data.data.confirm));
  });
  return router;
}
