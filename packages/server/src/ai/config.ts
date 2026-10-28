import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { providerInput, type ProviderConfig } from '../../../shared/src/ai';
import type { Store } from '../db/store';
import { isLoopbackHost, isPublicAddress } from '../network';
import { credentialOperation, type CredentialStore } from './credentials';
import { AiError } from './errors';

export const PROVIDER_SETTING = 'provider';
export type StoredProviderConfig = z.infer<typeof providerInput> & { keyRef: string | null };
export const saveProviderInput = providerInput.extend({ key: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/).optional() }).strict();
const storedProvider = providerInput.extend({ keyRef: z.string().regex(/^provider-[0-9a-f-]{36}$/).nullable().default(null) });

export function providerTarget(value: string) {
  const invalid = () => new AiError(400, 'AI_INVALID_BASE_URL', '请填写 HTTPS API 前缀；仅明确的 localhost、127.0.0.1 或 ::1 可使用 HTTP，不能包含凭据、查询、片段或完整 chat/completions 路径。');
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (/[?#\\\s]/.test(value) || url.username || url.password) throw invalid();
  const authority = value.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase() ?? '';
  const explicitLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(authority);
  if (isLoopbackHost(url.hostname) && !explicitLocal) throw invalid();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !explicitLocal && !isPublicAddress(host)) throw invalid();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && explicitLocal)) throw invalid();
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { throw invalid(); }
  if (/chat\/+completions(?:\/|$)/i.test(path) || path.includes('\\')) throw invalid();
  url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions';
  return { url: url.href, allowLoopback: explicitLocal };
}

/** Backup should omit keyRef (and all credentials) when exporting/restoring this setting. */
export function readStoredProvider(store: Store): StoredProviderConfig | null {
  const raw = store.setting<unknown>(PROVIDER_SETTING);
  if (raw == null) return null;
  const result = storedProvider.safeParse(raw);
  if (!result.success) throw new AiError(400, 'AI_CONFIG_INVALID', 'AI 配置无效，请重新保存配置。');
  providerTarget(result.data.baseUrl);
  return result.data;
}
export async function safeProvider(config: StoredProviderConfig | null, credentials: CredentialStore): Promise<ProviderConfig | null> {
  if (!config) return null;
  const { keyRef, ...visible } = config;
  const hasKey = !!(keyRef && await credentialOperation(() => credentials.get(keyRef)));
  return { ...visible, hasKey };
}
export async function saveProvider(store: Store, credentials: CredentialStore, input: z.infer<typeof saveProviderInput>) {
  providerTarget(input.baseUrl);
  const previous = readStoredProvider(store);
  const { key, ...config } = input;
  if (!key && previous?.keyRef && new URL(previous.baseUrl).origin !== new URL(config.baseUrl).origin) {
    throw new AiError(400, 'AI_KEY_REPLACEMENT_REQUIRED', '切换服务地址时请重新输入 Key，避免将原服务的凭据发送到其他服务。');
  }
  const keyRef = key ? `provider-${randomUUID()}` : previous?.keyRef ?? null;
  if (key && keyRef) await credentialOperation(() => credentials.set(keyRef, key));
  // Check access before changing the database; failure never creates a plaintext fallback.
  const visible = await safeProvider({ ...config, keyRef }, credentials);
  if (key && previous?.keyRef) await credentialOperation(() => credentials.delete(previous.keyRef!));
  store.setSetting(PROVIDER_SETTING, { ...config, keyRef });
  return visible;
}
export async function deleteProviderKey(store: Store, credentials: CredentialStore) {
  const config = readStoredProvider(store);
  if (!config?.keyRef) return;
  await credentialOperation(() => credentials.delete(config.keyRef!));
  store.setSetting(PROVIDER_SETTING, { ...config, keyRef: null });
}
export async function activeProvider(store: Store, credentials: CredentialStore) {
  const config = readStoredProvider(store);
  if (!config || !config.enabled) throw new AiError(400, 'AI_NOT_CONFIGURED', '请先配置并启用 AI 服务。');
  const key = config.keyRef ? await credentialOperation(() => credentials.get(config.keyRef!)) : null;
  if (!key) throw new AiError(400, 'AI_KEY_REQUIRED', '请在设置中保存 API Key 后再发送请求。');
  return { config, key };
}
