import * as SecureStore from 'expo-secure-store';
import { tokenStore } from '../src/secure-store';

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

  it('EVM-009 AC6: clear removes every slot', async () => {
    await tokenStore.set('refreshToken', 'a');
    await tokenStore.set('databaseKey', 'b');
    await tokenStore.clear();
    expect(await tokenStore.get('refreshToken')).toBeNull();
    expect(await tokenStore.get('databaseKey')).toBeNull();
  });
});
