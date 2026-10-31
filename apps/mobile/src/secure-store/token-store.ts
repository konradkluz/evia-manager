/**
 * Secure store for secrets (EVM-009 AC6, EVM-093; SR-MOB-01, SR-MOB-03, SR-MOB-04; MASVS-STORAGE-1): the only module that touches
 * expo-secure-store (Android Keystore / iOS Keychain). Slots: the refresh token (the only slot of a live session), the key of the
 * local database, the installation identity of the device, the pending revocation of a session ended offline (EVM-100 AC7: a refresh
 * token that only ever ends its session on the server) and the session record (EVM-100: user id, display name, role for the UI,
 * start — no e-mail, no token). Nothing here logs a value. No biometric prompt (`requireAuthentication` off) — the decision on biometrics is
 * an ADR; the iOS accessibility class is set although it has no effect on Android.
 * The database key has its OWN keychain service, so its Keystore alias can be deleted on its own (crypto-shred, EVM-093 AC6) without
 * touching the alias that wraps the refresh token.
 */
import * as SecureStore from 'expo-secure-store';

export type SecretSlot = 'refreshToken' | 'databaseKey' | 'installationIdentity' | 'revocationToken' | 'sessionMeta';

const KEYS: Readonly<Record<SecretSlot, string>> = {
  refreshToken: 'evia.refresh-token',
  databaseKey: 'evia.database-key',
  installationIdentity: 'evia.installation-identity',
  revocationToken: 'evia.revocation-token',
  sessionMeta: 'evia.session-meta',
};

/** Keychain service (Android: suffix of the Keystore alias) of the database key. */
export const DATABASE_KEY_SERVICE = 'evia.database-key';

const BASE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

const optionsOf = (slot: SecretSlot): SecureStore.SecureStoreOptions =>
  slot === 'databaseKey' ? { ...BASE, keychainService: DATABASE_KEY_SERVICE } : BASE;

export const tokenStore = {
  async get(slot: SecretSlot): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS[slot], optionsOf(slot));
  },

  async set(slot: SecretSlot, value: string): Promise<void> {
    if (value === '') throw new Error('An empty secret is not stored');
    await SecureStore.setItemAsync(KEYS[slot], value, optionsOf(slot));
  },

  async delete(slot: SecretSlot): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS[slot], optionsOf(slot));
  },

  /**
   * Removes every slot, one after another (never in parallel). ONLY for the wipe of company data (EVM-093 AC6): sign-out and
   * `session_revoked` delete the refresh token alone, because the database key protects the unsent queue (AC7).
   */
  async clear(): Promise<void> {
    for (const slot of Object.keys(KEYS) as SecretSlot[]) await this.delete(slot);
  },
};
