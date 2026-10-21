/**
 * Secure store for secrets (EVM-009 AC6; SR-MOB-01, SR-MOB-03; MASVS-STORAGE-1): the only module that touches expo-secure-store
 * (Android Keystore / iOS Keychain). It is prepared and unused until login (M2): slots for the refresh token and for the key of the
 * local database. Nothing here logs a value. No biometric prompt (`requireAuthentication` off) — the decision on biometrics is an
 * ADR; the iOS accessibility class is set although it has no effect on Android.
 */
import * as SecureStore from 'expo-secure-store';

export type SecretSlot = 'refreshToken' | 'databaseKey';

const KEYS: Readonly<Record<SecretSlot, string>> = {
  refreshToken: 'evia.refresh-token',
  databaseKey: 'evia.database-key',
};

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

export const tokenStore = {
  async get(slot: SecretSlot): Promise<string | null> {
    return SecureStore.getItemAsync(KEYS[slot], OPTIONS);
  },

  async set(slot: SecretSlot, value: string): Promise<void> {
    if (value === '') throw new Error('An empty secret is not stored');
    await SecureStore.setItemAsync(KEYS[slot], value, OPTIONS);
  },

  async delete(slot: SecretSlot): Promise<void> {
    await SecureStore.deleteItemAsync(KEYS[slot], OPTIONS);
  },

  /** Removes every slot (logout, "wyczyść dane firmowe"). */
  async clear(): Promise<void> {
    await Promise.all((Object.keys(KEYS) as SecretSlot[]).map((slot) => this.delete(slot)));
  },
};
