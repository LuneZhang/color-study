import { AiError } from './errors';

/** The account name (keyRef), never the secret, may be inspected by backup code. */
export const KEYRING_SERVICE = 'ColorStudy.AI';
export interface CredentialStore {
  get(keyRef: string): Promise<string | null>;
  set(keyRef: string, key: string): Promise<void>;
  delete(keyRef: string): Promise<void>;
}
export async function credentialOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { throw new AiError(503, 'KEYCHAIN_UNAVAILABLE', 'macOS 钥匙串不可用，请解锁或修复钥匙串后重试；不会将 Key 保存为明文。'); }
}

/** Lazy import avoids touching the keychain at startup or in injected contract tests. */
export class KeychainCredentialStore implements CredentialStore {
  private async entry(keyRef: string) {
    if (process.platform !== 'darwin') throw new Error('macOS keychain required');
    if (!/^provider-[0-9a-f-]{36}$/.test(keyRef)) throw new Error('Invalid credential reference');
    const { Entry } = await import('@napi-rs/keyring');
    return new Entry(KEYRING_SERVICE, keyRef);
  }
  get(keyRef: string) { return credentialOperation(async () => (await this.entry(keyRef)).getPassword()); }
  set(keyRef: string, key: string) { return credentialOperation(async () => { (await this.entry(keyRef)).setPassword(key); }); }
  delete(keyRef: string) { return credentialOperation(async () => { (await this.entry(keyRef)).deleteCredential(); }); }
}
