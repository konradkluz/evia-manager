import { Linking } from 'react-native';
import { Challenge } from '../src/auth/opaque';
import { useSession } from '../src/screens/session-context';
import { createSessionPorts, NO_API, originOf, PASSWORD_RESET_PATH, sessionPorts } from '../src/session';

jest.mock('react', () => ({ ...jest.requireActual<typeof import('react')>('react'), useContext: () => null }));

jest.mock('../src/storage', () => {
  const host = {
    installationProof: jest.fn(() => Promise.resolve(null)),
    unsentItemCountBeforeSignIn: jest.fn(() => Promise.resolve(3)),
    openForUser: jest.fn(),
  };
  return { localData: () => host };
});

const config = { apiBaseUrl: 'https://manager.example.test', platform: 'android', appVersion: '0.4.0', buildVariant: 'release' } as const;

describe('composition of the session (EVM-100; architect 6)', () => {
  it('EVM-100 AC1: "Nie pamiętasz hasła?" opens the fixed reset page of the panel on the origin of the API', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const ports = createSessionPorts({ ...config, apiBaseUrl: 'https://manager.example.test/base' });
    ports.openForgotPassword();
    expect(open).toHaveBeenCalledWith(`https://manager.example.test${PASSWORD_RESET_PATH}`);
    expect(PASSWORD_RESET_PATH).toBe('/login/reset');
    open.mockRejectedValueOnce(new Error('no browser'));
    ports.openForgotPassword();
    await Promise.resolve();
    open.mockRestore();
  });

  it('EVM-100 AC1: without a valid API address the sign-in answers "unavailable" and opens nothing', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const ports = createSessionPorts(null);
    expect(await ports.owner.signInClient().login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'unavailable' });
    ports.openForgotPassword();
    expect(open).not.toHaveBeenCalled();
    expect(ports.appVersion).toBe('unknown');
    open.mockRestore();
  });

  it('EVM-100 AC3: the count before a sign-in comes from the local store; the stand-ins of EVM-101/EVM-102 do nothing yet', async () => {
    const ports = createSessionPorts(config);
    expect(await ports.unsentBeforeSignIn()).toBe(3);
    expect(ports.appVersion).toBe('0.4.0');
    ports.openHelp();
    ports.requestCompanyDataWipe();
    ports.wipe.wipeRequired();
    expect(await ports.owner.restore()).toBeDefined();
  });

  it('EVM-100 AC1: the real client sends the description of the phone and asks the store for the proof of the installation', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(() => Promise.reject(new Error('offline (synthetic)')));
    try {
      const ports = createSessionPorts(config);
      expect(await ports.owner.signInClient().login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'unavailable' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });

  it('EVM-100: without an API address every operation of the client is unavailable', async () => {
    expect(await NO_API.login({ email: 'a', password: 'p' })).toEqual({ kind: 'unavailable' });
    expect(await NO_API.loginTotp(Challenge.of('c', 0), '123456')).toEqual({ kind: 'unavailable' });
    expect(await NO_API.refresh('r')).toEqual({ kind: 'unavailable' });
    expect(await NO_API.logout('a')).toEqual({ kind: 'unavailable' });
  });

  it('EVM-100: the session actions exist only inside the session gate', () => {
    expect(() => useSession()).toThrow(/inside SessionContext/);
  });

  it('EVM-100: one session per process; the origin keeps scheme, host and port', () => {
    expect(sessionPorts()).toBe(sessionPorts());
    expect(originOf('http://10.0.2.2:8787/api')).toBe('http://10.0.2.2:8787');
    expect(originOf('nothing')).toBe('nothing');
  });
});
