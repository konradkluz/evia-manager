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
    await tokenStore.set('refreshToken', 'synthetic-refresh-token');
    await tokenStore.set('databaseKey', 'synthetic-database-key');
    expect(await tokenStore.get('refreshToken')).toBe('synthetic-refresh-token');
    expect(await tokenStore.get('databaseKey')).toBe('synthetic-database-key');
    await tokenStore.delete('refreshToken');
    expect(await tokenStore.get('refreshToken')).toBeNull();
    expect(await tokenStore.get('databaseKey')).toBe('synthetic-database-key');
  });

  it('EVM-009 AC6: every call passes the device-only accessibility class and no authentication prompt', async () => {
    await tokenStore.set('refreshToken', 'synthetic');
    await tokenStore.get('refreshToken');
    await tokenStore.delete('refreshToken');
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false };
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith(expect.any(String), 'synthetic', options);
    expect(SecureStore.getItemAsync).toHaveBeenLastCalledWith(expect.any(String), options);
    expect(SecureStore.deleteItemAsync).toHaveBeenLastCalledWith(expect.any(String), options);
  });

  it('EVM-009 AC6: an empty secret is refused instead of being stored as "nothing"', async () => {
    await expect(tokenStore.set('refreshToken', '')).rejects.toThrow('empty secret');
  });

  it('EVM-009 AC6, EVM-093 AC6: clear removes every slot, one after another', async () => {
    await tokenStore.set('refreshToken', 'a');
    await tokenStore.set('databaseKey', 'b');
    await tokenStore.set('installationIdentity', 'c');
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    await tokenStore.clear();
    expect(await tokenStore.get('refreshToken')).toBeNull();
    expect(await tokenStore.get('databaseKey')).toBeNull();
    expect(await tokenStore.get('installationIdentity')).toBeNull();
    expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map((call) => call[0])).toEqual([
      'evia.refresh-token',
      'evia.database-key',
      'evia.installation-identity',
      'evia.revocation-token',
      'evia.session-meta',
    ]);
  });

  it('EVM-100 AC7, AC1: the pending revocation and the session record are own slots of the same class as the refresh token, removed by the wipe', async () => {
    await tokenStore.set('revocationToken', 'synthetic-revocation');
    await tokenStore.set('sessionMeta', '{"v":1}');
    const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false };
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('evia.revocation-token', 'synthetic-revocation', options);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('evia.session-meta', '{"v":1}', options);
    await tokenStore.delete('refreshToken');
    expect(await tokenStore.get('revocationToken')).toBe('synthetic-revocation');
    await tokenStore.clear();
    expect(await tokenStore.get('revocationToken')).toBeNull();
    expect(await tokenStore.get('sessionMeta')).toBeNull();
  });

  it('EVM-093 AC6: the database key has its own keychain service (its Keystore alias can be destroyed alone)', async () => {
    await tokenStore.set('databaseKey', 'synthetic');
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('evia.database-key', 'synthetic', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: false,
      keychainService: DATABASE_KEY_SERVICE,
    });
    await tokenStore.set('refreshToken', 'synthetic');
    expect(jest.mocked(SecureStore.setItemAsync).mock.lastCall?.[2]).not.toHaveProperty('keychainService');
  });
});
