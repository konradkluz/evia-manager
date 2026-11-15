/**
 * Secure store for secrets (EVM-009 AC6, EVM-093; SR-MOB-01, SR-MOB-03, SR-MOB-04; MASVS-STORAGE-1): the only module that touches
 * expo-secure-store (Android Keystore / iOS Keychain). Slots: the key of the local database, the installation identity of the
 * device, the wipe confirmation to send (EVM-101) and the session record (EVM-100: user id, display name, role for the UI, start —
 * no e-mail, no token). The refresh token and the pending revocation are NOT here any more (EVM-130 AC3, ADR-0020a, SR-SESS-09):
 * they live only in the native store of the upload module and JavaScript has no way to read them; the two slots of the older
 * versions are removed at start without being read (`purgeLegacyTokens`). Nothing here logs a value. No biometric prompt (`requireAuthentication` off) — the decision on biometrics is
 * an ADR; the iOS accessibility class is set although it has no effect on Android.
 * The database key has its OWN keychain service, so its Keystore alias can be deleted on its own (crypto-shred, EVM-093 AC6) without
 * touching the alias that wraps the other slots.
 */
import * as SecureStore from 'expo-secure-store';

export type SecretSlot = 'databaseKey' | 'installationIdentity' | 'sessionMeta' | 'wipeConfirmation';

const KEYS: Readonly<Record<SecretSlot, string>> = {
  databaseKey: 'evia.database-key',
  installationIdentity: 'evia.installation-identity',
  sessionMeta: 'evia.session-meta',
  wipeConfirmation: 'evia.wipe-confirmation',
};

/**
 * Keys of the slots of versions before EVM-130 (the refresh token and the pending revocation). Never read: only deleted (the update
 * asks the user to sign in once more; the queue and the local data stay).
 */
const LEGACY_TOKEN_KEYS: readonly string[] = ['evia.refresh-token', 'evia.revocation-token'];

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
   * Removes every slot but the wipe confirmation, one after another (never in parallel). ONLY for the wipe of company data
   * (EVM-093 AC6): sign-out and `session_revoked` delete the refresh token alone, because the database key protects the unsent queue
   * (AC7). The slot `wipeConfirmation` (EVM-101 AC4, architect 1) is EXPLICITLY kept: the contract of `confirmDeviceWipe` needs the
   * pair `deviceId` + installation secret after the data are gone; it is removed after the server's answer only.
   */
  async clear(): Promise<void> {
    for (const slot of Object.keys(KEYS) as SecretSlot[]) if (slot !== 'wipeConfirmation') await this.delete(slot);
    for (const key of LEGACY_TOKEN_KEYS) await SecureStore.deleteItemAsync(key, BASE);
  },

  /**
   * Start of the app (EVM-130 AC3): removes the two slots of the older versions WITHOUT reading them (a read would hand a refresh
   * token to JavaScript). Each key is tried even when the other fails; `false` = something stayed, the next start tries again.
   */
  async purgeLegacyTokens(): Promise<boolean> {
    let all = true;
    for (const key of LEGACY_TOKEN_KEYS) {
      try {
        await SecureStore.deleteItemAsync(key, BASE);
      } catch {
        all = false;
      }
    }
    return all;
  },
};
