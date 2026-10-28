import { serve } from '@hono/node-server';
import { Store } from './db/store';
import { createApp } from './app';
import { seedIfNeeded } from './seed';

const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须是 1024-65535 之间的整数');
const store = new Store();
const seeded = seedIfNeeded(store);
const development = process.env.NODE_ENV !== 'production';
const { app, feeds } = createApp(store, { port, development, webPort: Number(process.env.WEB_PORT ?? 5173) });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, info => {
  console.log(`调色书房已启动：http://127.0.0.1:${info.port}`);
  console.log(`资料目录：${store.dataDir}`);
  if (seeded.seeded) console.log(`已载入 ${seeded.tutorials} 条首批教程资料`);
});
if (process.env.COLOR_STUDY_DISABLE_FEEDS !== '1') feeds.start();
function shutdown() {
  feeds.stop(); server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
