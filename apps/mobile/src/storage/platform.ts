/**
 * Production implementations of the native ports (EVM-093): expo-secure-store (through `tokenStore`), the local Kotlin module
 * `evia-keystore`, expo-file-system and expo-crypto. Errors of these libraries carry key names and paths, so every one of them is
 * swallowed into a code here (SR-LOG-08); no value is logged.
 */
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes } from 'expo-crypto';
import { requireOptionalNativeModule } from 'expo';
import { File, Paths } from 'expo-file-system';
import { DATABASE_KEY_SERVICE, tokenStore } from '../secure-store';
import { StorageError } from './errors';
import type { AppFiles, CryptoSource, DeviceSecrets, InstallationIdentity, KeyHardware, KeyRead, KeyVault } from './ports';

interface EviaKeystoreNative {
  deleteServiceAliases(service: string): Promise<boolean>;
  securityLevel(service: string): Promise<string>;
}

const HARDWARE: readonly KeyHardware[] = ['strongbox', 'secure_hardware', 'software', 'unknown'];

export function createKeyVault(
  native: EviaKeystoreNative | null = requireOptionalNativeModule<EviaKeystoreNative>('EviaKeystore'),
): KeyVault {
  return {
    async read(): Promise<KeyRead> {
      try {
        const hex = await tokenStore.get('databaseKey');
        // expo-secure-store answers null also for an invalidated Keystore key or a value it cannot decrypt (it deletes it first):
        // that is "key missing" for the user (same message as key_invalid, architecture review 3).
        return hex === null ? { kind: 'absent' } : { kind: 'present', hex };
      } catch {
        return { kind: 'unavailable' };
      }
    },
    async write(hex: string): Promise<void> {
      try {
        await tokenStore.set('databaseKey', hex);
      } catch {
        throw new StorageError('key_unavailable');
      }
    },
    async destroy(): Promise<void> {
      try {
        await tokenStore.delete('databaseKey');
        if (native === null || !(await native.deleteServiceAliases(DATABASE_KEY_SERVICE))) throw new StorageError('key_unavailable');
      } catch {
        // the marker stays and the step is repeated: deleting the wrapped value alone is not a crypto-shred
        throw new StorageError('key_unavailable');
      }
    },
    async hardware(): Promise<KeyHardware> {
      try {
        const level = await native?.securityLevel(DATABASE_KEY_SERVICE);
        return HARDWARE.find((h) => h === level) ?? 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
}

/** Small files in the internal documents directory (`filesDir`; excluded from cloud backup and device transfer by with-hardening). */
export function createAppFiles(directory: ConstructorParameters<typeof File>[0] = Paths.document): AppFiles {
  const fileOf = (name: string): File => new File(directory, name);
  return {
    async read(name: string): Promise<string | null> {
      try {
        const file = fileOf(name);
        return file.exists ? await file.text() : null;
      } catch {
        throw new StorageError('file_unavailable');
      }
    },
    async write(name: string, text: string): Promise<void> {
      try {
        const file = fileOf(name);
        if (!file.exists) file.create();
        await file.write(text);
      } catch {
        throw new StorageError('file_unavailable');
      }
    },
    remove(name: string): Promise<void> {
      try {
        const file = fileOf(name);
        if (file.exists) file.delete();
        return Promise.resolve();
      } catch {
        return Promise.reject(new StorageError('file_unavailable'));
      }
    },
  };
}

/** expo-crypto: the platform CSPRNG (SecureRandom) and SHA-256. Hermes does not guarantee a global `crypto.getRandomValues`. */
export const expoCrypto: CryptoSource = {
  getRandomBytes: (length) => getRandomBytes(length),
  sha256Hex: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.HEX }),
};

const isIdentity = (value: unknown): value is InstallationIdentity =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { deviceId?: unknown }).deviceId === 'string' &&
  typeof (value as { secret?: unknown }).secret === 'string';

export const deviceSecrets: DeviceSecrets = {
  async readIdentity(): Promise<InstallationIdentity | null> {
    const text = await tokenStore.get('installationIdentity');
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      return isIdentity(value) ? { deviceId: value.deviceId, secret: value.secret } : null;
    } catch {
      return null;
    }
  },
  writeIdentity: (identity) =>
    tokenStore.set('installationIdentity', JSON.stringify({ deviceId: identity.deviceId, secret: identity.secret })),
  deleteIdentity: () => tokenStore.delete('installationIdentity'),
  deleteRefreshToken: () => tokenStore.delete('refreshToken'),
  deleteAllSecrets: () => tokenStore.clear(),
  // The app has no preference store and no crash-report SDK yet (EVM-093): the steps exist so the order of the wipe is fixed.
  deletePreferences: () => Promise.resolve(),
  deleteCrashReports: () => Promise.resolve(),
};
