import * as SecureStore from 'expo-secure-store';
import { logDiagnostic } from '../../src/logging/log';
import { createAppFiles, createKeyVault, deviceSecrets, expoCrypto } from '../../src/storage/platform';

const mockFiles = new Map<string, string>();
const mockFileFailures = { read: false, write: false, remove: false };

jest.mock('expo-secure-store', () => {
  const data = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 6,
    getItemAsync: jest.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///data/user/0/synthetic/files' },
  File: class {
    readonly key: string;
    constructor(directory: string, name: string) {
      this.key = `${directory}/${name}`;
    }
    get exists(): boolean {
      if (mockFileFailures.read) throw new Error('/data/user/0/synthetic/files: I/O');
      return mockFiles.has(this.key);
    }
    text(): Promise<string> {
      return Promise.resolve(mockFiles.get(this.key) ?? '');
    }
    create(): void {
      if (mockFileFailures.write) throw new Error('/data/user/0/synthetic/files: no space');
      mockFiles.set(this.key, '');
    }
    write(text: string): Promise<void> {
      mockFiles.set(this.key, text);
      return Promise.resolve();
    }
    delete(): void {
      if (mockFileFailures.remove) throw new Error('/data/user/0/synthetic/files: busy');
      mockFiles.delete(this.key);
    }
  },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomBytes: jest.fn((n: number) => new Uint8Array(n).fill(7)),
  digestStringAsync: jest.fn(() => Promise.resolve('d'.repeat(64))),
}));

beforeEach(() => {
  mockFiles.clear();
  mockFileFailures.read = false;
  mockFileFailures.write = false;
  mockFileFailures.remove = false;
});

const native = (deleted = true, level: string | Error = 'secure_hardware') => ({
  deleteServiceAliases: jest.fn(() => Promise.resolve(deleted)),
  securityLevel: jest.fn(() => (level instanceof Error ? Promise.reject(level) : Promise.resolve(level))),
});

const hex = (): string => ['a', 'b'].join('').repeat(32);

describe('production ports of the local store (EVM-093 AC1, AC5, AC6)', () => {
  it('EVM-093 AC1: the vault stores the key under its own keychain service and reads it back', async () => {
    const vault = createKeyVault(native());
    expect(await vault.read()).toEqual({ kind: 'absent' });
    await vault.write(hex());
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(
      'evia.database-key',
      hex(),
      expect.objectContaining({ keychainService: 'evia.database-key' }),
    );
    expect(await vault.read()).toEqual({ kind: 'present', hex: hex() });
  });

  it('EVM-093 AC5: any error of the secure store is "unavailable" (retry), never "absent"', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("Could not decrypt the value for key 'evia.database-key'"));
    expect(await createKeyVault(native()).read()).toEqual({ kind: 'unavailable' });
  });

  it('EVM-093 AC1: a failed write is a code without the library message', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("key 'evia.database-key' under keychain"));
    const error = await createKeyVault(native())
      .write(hex())
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe('key_unavailable');
  });

  it('EVM-093 AC6: destroy deletes the wrapped key AND the Keystore aliases of its service (crypto-shred)', async () => {
    const module = native();
    const vault = createKeyVault(module);
    await vault.write(hex());
    await vault.destroy();
    expect(await vault.read()).toEqual({ kind: 'absent' });
    expect(module.deleteServiceAliases).toHaveBeenCalledWith('evia.database-key');
    await vault.destroy();
  });

  it('EVM-093 AC6: destroy fails (the wipe step is repeated) when the alias is left or the module is missing', async () => {
    await expect(createKeyVault(native(false)).destroy()).rejects.toMatchObject({ code: 'key_unavailable' });
    await expect(createKeyVault(null).destroy()).rejects.toMatchObject({ code: 'key_unavailable' });
    const throwing = {
      deleteServiceAliases: () => Promise.reject(new Error('alias AES/GCM/NoPadding:evia.database-key')),
      securityLevel: () => Promise.resolve(''),
    };
    const error = await createKeyVault(throwing)
      .destroy()
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe('key_unavailable');
  });

  it('EVM-093 AC1: the hardware fact is mapped to a fixed vocabulary and never throws', async () => {
    expect(await createKeyVault(native(true, 'strongbox')).hardware()).toBe('strongbox');
    expect(await createKeyVault(native(true, 'software')).hardware()).toBe('software');
    expect(await createKeyVault(native(true, 'tee-with-a-story')).hardware()).toBe('unknown');
    expect(await createKeyVault(native(true, new Error('x'))).hardware()).toBe('unknown');
    expect(await createKeyVault(null).hardware()).toBe('unknown');
  });

  it('EVM-093 AC6: small files are read, written, removed idempotently; I/O errors become codes without paths', async () => {
    const appFiles = createAppFiles('file:///synthetic');
    expect(await appFiles.read('marker')).toBeNull();
    await appFiles.write('marker', '1');
    await appFiles.write('marker', '1');
    expect(await appFiles.read('marker')).toBe('1');
    await appFiles.remove('marker');
    await appFiles.remove('marker');
    expect(await appFiles.read('marker')).toBeNull();
    mockFileFailures.write = true;
    await expect(appFiles.write('other', '1')).rejects.toMatchObject({ message: 'file_unavailable' });
    mockFileFailures.read = true;
    await expect(appFiles.read('marker')).rejects.toMatchObject({ message: 'file_unavailable' });
    mockFileFailures.read = false;
    mockFileFailures.write = false;
    await appFiles.write('marker', '1');
    mockFileFailures.remove = true;
    await expect(appFiles.remove('marker')).rejects.toMatchObject({ message: 'file_unavailable' });
    expect(await createAppFiles().read('none')).toBeNull();
  });

  it('EVM-093 AC1: the CSPRNG and SHA-256 come from expo-crypto', async () => {
    expect(expoCrypto.getRandomBytes(32)).toHaveLength(32);
    expect(await expoCrypto.sha256Hex('x')).toBe('d'.repeat(64));
  });

  it('EVM-093 AC5, AC7: the installation identity round-trips; anything unreadable counts as "no identity" (a new device)', async () => {
    expect(await deviceSecrets.readIdentity()).toBeNull();
    await deviceSecrets.writeIdentity({ deviceId: 'device-synthetic', secret: 'secret-synthetic' });
    expect(await deviceSecrets.readIdentity()).toEqual({ deviceId: 'device-synthetic', secret: 'secret-synthetic' });
    await SecureStore.setItemAsync('evia.installation-identity', '{broken');
    expect(await deviceSecrets.readIdentity()).toBeNull();
    await SecureStore.setItemAsync('evia.installation-identity', '{"deviceId":1}');
    expect(await deviceSecrets.readIdentity()).toBeNull();
    await deviceSecrets.deleteIdentity();
    expect(await deviceSecrets.readIdentity()).toBeNull();
  });

  it('EVM-093 AC7: sign-out deletes only the refresh token; the wipe deletes every slot', async () => {
    await SecureStore.setItemAsync('evia.refresh-token', 'r');
    await SecureStore.setItemAsync('evia.database-key', 'k');
    await deviceSecrets.deleteRefreshToken();
    expect(await SecureStore.getItemAsync('evia.refresh-token')).toBeNull();
    expect(await SecureStore.getItemAsync('evia.database-key')).toBe('k');
    await deviceSecrets.deleteAllSecrets();
    expect(await SecureStore.getItemAsync('evia.database-key')).toBeNull();
    await expect(deviceSecrets.deletePreferences()).resolves.toBeUndefined();
    await expect(deviceSecrets.deleteCrashReports()).resolves.toBeUndefined();
  });

  it('EVM-093 AC1, SR-LOG-08: diagnostics print a fixed name and an allow-listed code only', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    logDiagnostic({ event: 'db-open-failed', code: 'key_missing' });
    logDiagnostic({ event: 'keystore-hardware', level: 'software' });
    logDiagnostic({ event: 'wipe-step-failed', step: 'database_key' });
    logDiagnostic({ event: 'db-open-failed', code: `/data/${hex()}` });
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '[evia] db-open-failed key_missing',
      '[evia] keystore-hardware software',
      '[evia] wipe-step-failed database_key',
      '[evia] db-open-failed invalid',
    ]);
    warn.mockRestore();
  });
});
