import { Hono } from 'hono';
import { ZodError } from 'zod';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError } from './errors';
import type { Store } from './db/store';
import { createSecurity, securityHeaders } from './security';
import { createTutorialRouter } from './tutorials/catalog';
import { createLibraryRouter } from './tutorials/library';
import { createPracticeRouter } from './tutorials/practices';
import { createKnowledgeRouter } from './knowledge/routes';
import { createMediaRouter } from './media';
import { createSourceRouter } from './feeds/routes';
import { FeedService } from './feeds/service';
import { createAiRouter } from './ai';
import { createBackupRouter } from './backup';
import { createSettingsRouter } from './settings/routes';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const webRoot = resolve(fileURLToPath(new URL('../../web/dist/', import.meta.url)));

export function createApp(store: Store, options: { port: number; development?: boolean; webPort?: number; aiRequest?: typeof import('./network').safeRequest } = { port: 4317 }) {
  const app = new Hono();
  const security = createSecurity(store, { port: options.port, development: options.development, webPort: options.webPort });
  const feeds = new FeedService(store);
  app.use('*', securityHeaders);
  app.use('*', security.middleware);
  app.get('/api/session', c => c.json({ csrfToken: security.token }));
  app.get('/api/status', c => c.json({ ok: true, schemaVersion: store.db.pragma('user_version', { simple: true }) }));
  app.route('/api/tutorials', createTutorialRouter(store));
  app.route('/api/library', createLibraryRouter(store));
  app.route('/api/practices', createPracticeRouter(store));
  app.route('/api/knowledge', createKnowledgeRouter(store));
  app.route('/api/assets', createMediaRouter(store));
  app.route('/api/sources', createSourceRouter(store, feeds));
  app.route('/api/ai', createAiRouter(store, options.aiRequest ? { request: options.aiRequest } : {}));
  app.route('/api/backups', createBackupRouter(store));
  app.route('/api/settings', createSettingsRouter(store));
  app.onError((error, c) => {
    const requestId = randomUUID();
    if (error instanceof AppError) return c.json({ error: { code: error.code, message: error.message, requestId } }, error.status as never);
    if (error instanceof ZodError) return c.json({ error: { code: 'INVALID_INPUT', message: error.issues.map(issue => issue.message).join('；'), requestId } }, 400);
    console.error(`[${requestId}]`, error instanceof Error ? error.message : 'Unexpected error');
    return c.json({ error: { code: 'INTERNAL', message: '操作没有完成，请稍后重试。', requestId } }, 500);
  });
  app.notFound(c => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'NOT_FOUND', message: '接口不存在' } }, 404);
    if (c.req.method !== 'GET') return c.text('Not found', 404);
    const requested = resolve(webRoot, '.' + decodeURIComponent(c.req.path));
    const file = requested.startsWith(webRoot + sep) && existsSync(requested) && statSync(requested).isFile() ? requested : join(webRoot, 'index.html');
    if (!existsSync(file)) return c.text('界面尚未构建。开发时请打开 Vite 地址，或先运行 npm run build。', 503);
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' } });
  });
  return { app, feeds };
}
