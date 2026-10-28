import { Hono } from 'hono';
import { z } from 'zod';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../db/store';
function directorySize(path: string) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'backups' || entry.name === 'tmp') continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) total += directorySize(target);
    else if (entry.isFile()) total += statSync(target).size;
  }
  return total;
}
export function createSettingsRouter(store: Store) {
  const app = new Hono();
  app.get('/', c => c.json({ softwareVersion: store.setting<string>('softwareVersion') ?? '', dataDir: store.dataDir, storageBytes: directorySize(store.dataDir) }));
  app.patch('/', async c => {
    const input = z.object({ softwareVersion: z.string().max(200) }).parse(await c.req.json());
    store.setSetting('softwareVersion', input.softwareVersion.trim());
    return c.json({ softwareVersion: input.softwareVersion.trim() });
  });
  return app;
}
