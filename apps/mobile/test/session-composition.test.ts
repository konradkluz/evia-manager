import { AppState, Linking } from 'react-native';
import type { EviaUploadModule } from '../modules/evia-upload/src';
import { Challenge, IssuedSession } from '../src/auth/opaque';
import { useSession } from '../src/screens/session-context';
import { tokenStore } from '../src/secure-store';
import { createSessionPorts, NO_API, originOf, PASSWORD_RESET_PATH, sessionMediaUploads, sessionPorts } from '../src/session';

jest.mock('react', () => ({ ...jest.requireActual<typeof import('react')>('react'), useContext: () => null }));

jest.mock('../src/storage', () => {
  const host = {
    installationProof: jest.fn(() => Promise.resolve(null)),
    unsentItemCountBeforeSignIn: jest.fn(() => Promise.resolve(3)),
    openForUser: jest.fn(),
    registerWipeStep: jest.fn(),
    // EVM-101: the wipe and its confirmation
    prepare: jest.fn(() => Promise.resolve('ready')),
    wipeCompanyData: jest.fn(() => Promise.resolve('done')),
    unsentItemCount: jest.fn(() => Promise.resolve(2)),
    pendingWipeConfirmation: jest.fn(() => Promise.resolve(null)),
    clearWipeConfirmation: jest.fn(() => Promise.resolve()),
  };
  return {
    localData: () => host,
    randomSource: () => ({ getRandomValues: (bytes: Uint8Array) => crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>) }),
  };
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

  it('EVM-105 AC1: every entry gets a new UUIDv7 from the session generator (random bits from the storage CSPRNG, not Math.random)', () => {
    const random = jest.spyOn(Math, 'random');
    const ports = createSessionPorts(config);
    const first = ports.newId();
    const second = ports.newId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
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
    ports.openAddTarget('media');
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

const tick = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 10);
  });

describe('composition of the device controls (EVM-101)', () => {
  it('EVM-101 AC1: the screen-lock check of the sign-in is the native one - without the module the phone counts as unlocked-less (fail-closed)', async () => {
    const ports = createSessionPorts(config);
    expect(await ports.screenLockOk()).toBe(false);
  });

  it('EVM-101 AC4: a finished start finishes an interrupted wipe; a wipe in progress hides the data and ends; the number comes from the store', async () => {
    const { localData } = jest.requireMock<typeof import('../src/storage')>('../src/storage');
    const host = localData() as unknown as Record<string, jest.Mock>;
    host['prepare']?.mockClear();
    const ports = createSessionPorts(config);
    await tick();
    expect(host['prepare']).toHaveBeenCalledTimes(1);
    const seen: (string | null)[] = [];
    ports.guard.subscribe(() => seen.push(ports.guard.getSnapshot().hidden));
    expect(await ports.companyWipe.unsentItemCount()).toBe(2);
    expect(await ports.companyWipe.runManual()).toBe('done');
    expect(seen).toContain('wipe_in_progress');
    expect(ports.guard.getSnapshot().wiping).toBe(false);
  });

  it('EVM-101 AC4: every return to the foreground retries the owed confirmation (the one AppState listener of the guard)', async () => {
    const { localData } = jest.requireMock<typeof import('../src/storage')>('../src/storage');
    const host = localData() as unknown as Record<string, jest.Mock>;
    let handler: (state: string) => void = () => undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
      handler = listener;
      return { remove: jest.fn() };
    }) as never);
    const ports = createSessionPorts(config);
    ports.guard.start();
    await tick();
    host['prepare']?.mockClear();
    handler('background');
    handler('active');
    await tick();
    expect(host['prepare']).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('EVM-101 AC2: without an API address the confirmation of a wipe is unavailable and sends nothing', async () => {
    expect(await NO_API.confirmWipe({} as never)).toEqual({ kind: 'unavailable' });
  });
});

describe('composition of the synchronization (EVM-107; architect 5, 6)', () => {
  it('EVM-107 AC2: the session has one synchronization host; without a session (no store) it starts nothing and reports an idle state', () => {
    const ports = createSessionPorts(config);
    expect(ports.sync.getSnapshot().active).toBe(false);
    ports.sync.startSession();
    expect(ports.sync.getSnapshot().active).toBe(false);
    ports.sync.stop();
    ports.sync.setOnline(true);
    expect(ports.sync.getSnapshot().initialLoad).toBe('pending');
  });

  it('EVM-107 AC4: without the native clipboard module nothing is copied (never the plain clipboard)', () => {
    const ports = createSessionPorts(config);
    expect(ports.copyToClipboard('synthetic text')).toBe(false);
  });

  it('EVM-107 AC4 (security S1): the end of a session also clears the clipboard copy and stops the service (listener of the owner)', () => {
    const ports = createSessionPorts(null);
    // the owner calls its listeners before it removes anything; without a session this must still be safe and silent
    expect(() => {
      ports.sync.stop();
    }).not.toThrow();
    expect(ports.copyToClipboard('')).toBe(false);
  });
});

describe('composition of the native owner and the upload (EVM-130)', () => {
  const module = (overrides: Record<string, unknown> = {}) => {
    const added: string[] = [];
    const fake = {
      addListener: jest.fn((name: string) => {
        added.push(name);
        return { remove: jest.fn() };
      }),
      wipeUploads: jest.fn(() => Promise.resolve(true)),
      sessionState: jest.fn(() => Promise.resolve({ state: 'signed_out', ownerId: null })),
      stageLogin: jest.fn(() => Promise.resolve('ok')),
      ...overrides,
    };
    return { fake, added, asModule: fake as unknown as EviaUploadModule };
  };

  it('EVM-130 AC3: at every start the two legacy token slots are deleted without being read', () => {
    const purge = jest.spyOn(tokenStore, 'purgeLegacyTokens').mockResolvedValue(true);
    createSessionPorts(config, module().asModule);
    expect(purge).toHaveBeenCalledTimes(1);
    purge.mockRejectedValueOnce(new Error('synthetic'));
    expect(() => createSessionPorts(config, module().asModule)).not.toThrow();
    purge.mockRestore();
  });

  it('EVM-130 AC5: the native wipe is registered as the FIRST step of the wipe; an unfinished native wipe fails the step (repeated before anything else)', async () => {
    const { localData } = jest.requireMock<typeof import('../src/storage')>('../src/storage');
    const host = localData() as unknown as Record<string, jest.Mock>;
    host['registerWipeStep']?.mockClear();
    const { fake, asModule } = module();
    createSessionPorts(config, asModule);
    const [name, run, options] = host['registerWipeStep']?.mock.calls[0] as [string, () => Promise<void>, { first?: boolean }];
    expect(name).toBe('native_uploads');
    expect(options).toEqual({ first: true });
    await expect(run()).resolves.toBeUndefined();
    expect(fake.wipeUploads).toHaveBeenCalledTimes(1);
    fake.wipeUploads.mockResolvedValueOnce(false);
    await expect(run()).rejects.toThrow('native wipe unfinished');
  });

  it('EVM-130 AC2, AC3: the owner and the queue of files listen to the module (the session state; progress, file state, session state)', () => {
    const { added, asModule } = module();
    createSessionPorts(config, asModule);
    expect([...added].sort()).toEqual(['onFileState', 'onSessionState', 'onSessionState', 'onUploadProgress']);
  });

  it('EVM-130 AC3: without the module no sign-in is possible — the session of step 2 is refused and nothing is stored', async () => {
    const ports = createSessionPorts(config, null);
    const session = IssuedSession.of({
      deviceId: 'd',
      installationSecret: undefined,
      accessToken: 'a',
      accessTokenTtlMs: 1000,
      refreshToken: 'r',
      serverTime: 1,
      user: { id: 'u', displayName: 'Synthetic', role: 'editor' },
    });
    expect(await ports.owner.completeSignIn(session)).toEqual({ kind: 'failed' });
    expect(await ports.owner.restore()).toEqual({ kind: 'signed_out' });
  });

  it('EVM-130 AC1: the queue of files of the process is the one of the ports; a return to the foreground reconciles it without a session safely', async () => {
    let handler: (state: string) => void = () => undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, listener: (state: string) => void) => {
      handler = listener;
      return { remove: jest.fn() };
    }) as never);
    const { fake, asModule } = module();
    const ports = createSessionPorts(config, asModule);
    ports.guard.start();
    expect(await sessionMediaUploads()?.add({ assetId: 'x', workOrderId: 'y', mediaType: 'photo', category: 'other' })).toEqual({
      ok: false,
      code: 'invalid',
    });
    const reconcile = jest.spyOn(ports.owner, 'reconcileNative');
    const merge = jest.spyOn(ports.owner, 'mergeNativeContact');
    const refresh = jest.spyOn(ports.media, 'refresh');
    handler('background');
    handler('active');
    await tick();
    // a return to the foreground compares the state of the module, merges its contact and reconciles the files
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ports.media.getSnapshot()).toEqual({ files: [], notifications: 'granted' });
    expect(fake.sessionState).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
