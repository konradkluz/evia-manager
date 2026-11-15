import * as SecureStore from 'expo-secure-store';
import { DATABASE_KEY_SERVICE, tokenStore } from '../src/secure-store';

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

describe('secure store for secrets (EVM-009 AC6; SR-MOB-01)', () => {
  it('EVM-009 AC6: a secret is stored, read and deleted per slot', async () => {
    await tokenStore.set('sessionMeta', '{"v":1}');
    await tokenStore.set('databaseKey', 'synthetic-database-key');
    expect(await tokenStore.get('sessionMeta')).toBe('{"v":1}');
    expect(await tokenStore.get('databaseKey')).toBe('synthetic-database-key');
    await tokenStore.delete('sessionMeta');
    expect(await tokenStore.get('sessionMeta')).toBeNull();
    expect(await tokenStore.get('databaseKey')).toBe('synthetic-database-key');
  });

  it('EVM-009 AC6: every call passes the device-only accessibility class and no authentication prompt', async () => {
    await tokenStore.set('sessionMeta', 'synthetic');
    await tokenStore.get('sessionMeta');
    await tokenStore.delete('sessionMeta');
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false };
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(expect.any(String), 'synthetic', options);
    expect(SecureStore.getItemAsync).toHaveBeenLastCalledWith(expect.any(String), options);
    expect(SecureStore.deleteItemAsync).toHaveBeenLastCalledWith(expect.any(String), options);
  });

  it('EVM-009 AC6: an empty secret is refused instead of being stored as "nothing"', async () => {
    await expect(tokenStore.set('sessionMeta', '')).rejects.toThrow('empty secret');
  });

  it('EVM-009 AC6, EVM-093 AC6, EVM-130 AC3: clear removes every slot, the legacy token slots included, one after another', async () => {
    await tokenStore.set('sessionMeta', 'a');
    await tokenStore.set('databaseKey', 'b');
    await tokenStore.set('installationIdentity', 'c');
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    await tokenStore.clear();
    expect(await tokenStore.get('sessionMeta')).toBeNull();
    expect(await tokenStore.get('databaseKey')).toBeNull();
    expect(await tokenStore.get('installationIdentity')).toBeNull();
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map((call) => call[0])).toEqual([
      'evia.database-key',
      'evia.installation-identity',
      'evia.session-meta',
      'evia.refresh-token',
      'evia.revocation-token',
    ]);
  });

  it('EVM-101 AC4: clear keeps the wipe confirmation slot (the pair owed to confirmDeviceWipe); only an explicit delete removes it', async () => {
    await tokenStore.set('wipeConfirmation', '{"deviceId":"d","secret":"s"}');
    await tokenStore.set('sessionMeta', 'a');
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    await tokenStore.clear();
    expect(await tokenStore.get('wipeConfirmation')).toBe('{"deviceId":"d","secret":"s"}');
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map((call) => call[0])).not.toContain('evia.wipe-confirmation');
    await tokenStore.delete('wipeConfirmation');
    expect(await tokenStore.get('wipeConfirmation')).toBeNull();
  });

  it('EVM-100 AC1: the session record is an own slot of the same class, removed by the wipe', async () => {
    await tokenStore.set('sessionMeta', '{"v":1}');
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false };
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('evia.session-meta', '{"v":1}', options);
    await tokenStore.clear();
    expect(await tokenStore.get('sessionMeta')).toBeNull();
  });

  it('EVM-093 AC6: the database key has its own keychain service (its Keystore alias can be destroyed alone)', async () => {
    await tokenStore.set('databaseKey', 'synthetic');
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('evia.database-key', 'synthetic', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: false,
      keychainService: DATABASE_KEY_SERVICE,
    });
    await tokenStore.set('sessionMeta', 'synthetic');
    expect(jest.mocked(SecureStore.setItemAsync).mock.lastCall?.[2]).not.toHaveProperty('keychainService');
  });
});

describe('the legacy token slots (EVM-130 AC3; ADR-0020a, security A1)', () => {
  it('EVM-130 AC3: the refresh token and the pending revocation have no slot in JavaScript any more — no way to read them', () => {
    const slots: Parameters<typeof tokenStore.get>[0][] = ['databaseKey', 'installationIdentity', 'sessionMeta', 'wipeConfirmation'];
    // @ts-expect-error the refresh token is not a slot
    const refresh: Parameters<typeof tokenStore.get>[0] = 'refreshToken';
    // @ts-expect-error the pending revocation is not a slot
    const revocation: Parameters<typeof tokenStore.get>[0] = 'revocationToken';
    expect(slots).not.toContain(refresh);
    expect(slots).not.toContain(revocation);
    expect(Object.keys(tokenStore).sort()).toEqual(['clear', 'delete', 'get', 'purgeLegacyTokens', 'set']);
  });

  it('EVM-130 AC3: at start both legacy slots are removed WITHOUT being read; the other slots stay', async () => {
    await SecureStore.setItemAsync('evia.refresh-token', 'synthetic-old-refresh');
    await SecureStore.setItemAsync('evia.revocation-token', '["synthetic-old-pending"]');
    await tokenStore.set('sessionMeta', '{"v":1}');
    await tokenStore.set('installationIdentity', 'identity');
    jest.mocked(SecureStore.getItemAsync).mockClear();
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    expect(await tokenStore.purgeLegacyTokens()).toBe(true);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map((call) => call[0])).toEqual([
      'evia.refresh-token',
      'evia.revocation-token',
    ]);
    expect(await SecureStore.getItemAsync('evia.refresh-token')).toBeNull();
    expect(await SecureStore.getItemAsync('evia.revocation-token')).toBeNull();
    expect(await tokenStore.get('sessionMeta')).toBe('{"v":1}');
    expect(await tokenStore.get('installationIdentity')).toBe('identity');
  });

  it('EVM-130 AC3: a slot that cannot be deleted does not stop the other one and is reported as false (tried again at the next start)', async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('synthetic'));
    expect(await tokenStore.purgeLegacyTokens()).toBe(false);
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map((call) => call[0])).toEqual([
      'evia.refresh-token',
      'evia.revocation-token',
    ]);
    expect(await tokenStore.purgeLegacyTokens()).toBe(true);
  });
});
