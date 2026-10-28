import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { AppError } from './errors';
import type { Store } from './db/store';
export interface SecurityOptions { port: number; webPort?: number; development?: boolean }
export function createSecurity(store: Store, options: SecurityOptions) {
  const token = randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  if (options.development) {
    origins.add(`http://127.0.0.1:${options.webPort ?? 5173}`);
    origins.add(`http://localhost:${options.webPort ?? 5173}`);
  }
  const middleware: MiddlewareHandler = async (c, next) => {
    if (!hosts.has(c.req.header('host') ?? '')) throw new AppError(403, 'INVALID_HOST', '拒绝不受信任的主机名');
    const origin = c.req.header('origin');
    if (origin && !origins.has(origin)) throw new AppError(403, 'INVALID_ORIGIN', '拒绝来自其他站点的请求');
    if (c.req.header('sec-fetch-site') === 'cross-site') throw new AppError(403, 'CROSS_SITE_REQUEST', '不允许跨站访问本地资料');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const supplied = Buffer.from(c.req.header('x-csrf-token') ?? '');
      if (!origin || !origins.has(origin) || supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) {
        throw new AppError(403, 'CSRF_FAILED', '本地会话已失效，请刷新后重试');
      }
      if (store.maintenance) throw new AppError(503, 'MAINTENANCE', '正在恢复数据，请稍后重试');
    }
    await next();
  };
  return { token, middleware };
}
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', c.req.path.startsWith('/api') ? 'no-store' : 'no-cache');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  await next();
};
