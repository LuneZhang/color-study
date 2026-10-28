import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';
import { AppError } from './errors';

export function isPublicAddress(address: string) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}
export function isLoopbackHost(host: string) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host); }
export async function validateTarget(value: string, allowLoopback = false) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new AppError(400, 'UNSAFE_URL', '仅支持无内嵌凭据的 http(s) 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  const local = allowLoopback && isLoopbackHost(url.hostname);
  if (!addresses.length || addresses.some(item => local ? !['127.0.0.1', '::1'].includes(item.address) : !isPublicAddress(item.address))) {
    throw new AppError(400, 'UNSAFE_URL', '不允许访问内网、回环或保留地址');
  }
  return { url, addresses };
}
export interface NetworkOptions {
  method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal;
  allowLoopback?: boolean; timeout?: number;
}
export async function safeRequest(value: string, options: NetworkOptions = {}) {
  const { url, addresses } = await validateTarget(value, options.allowLoopback);
  const agent = new Agent({ connect: { lookup: (_hostname, lookupOptions, callback) => {
    const reply = callback as (...args: unknown[]) => void;
    if (typeof lookupOptions === 'object' && lookupOptions.all) reply(null, addresses);
    else reply(null, addresses[0].address, addresses[0].family);
  } } });
  try {
    const response = await request(url, {
      dispatcher: agent, method: options.method ?? 'GET', headers: options.headers, body: options.body,
      signal: options.signal, headersTimeout: options.timeout ?? 30000, bodyTimeout: options.timeout ?? 30000,
    });
    response.body.once('close', () => { void agent.close().catch(() => {}); });
    return response;
  } catch (error) { await agent.destroy(); throw error; }
}
export async function limitedText(body: AsyncIterable<Uint8Array> & { destroy?: () => void }, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) { body.destroy?.(); throw new AppError(413, 'RESPONSE_TOO_LARGE', '来源响应超过大小限制'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function canonicalUrl(value: string) {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_') || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  return url.href;
}
