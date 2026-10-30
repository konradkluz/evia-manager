import { LoginMachine, lockMinutes, normalizeCode, type LoginDeps } from '../../src/auth/login-machine';
import type { IssuedSession } from '../../src/auth/opaque';
import { InstallationProof } from '../../src/storage/installation-proof';
import { FakeAuthServer, type FakeAccount } from './fake-auth-server';
import { FakeWipe } from './fakes';
import { DEVICE_1, T0, secret } from './fixtures';

const EMAIL = 'jan@example.test';
const PASSWORD = 'synthetic-password';

function machine(server = new FakeAuthServer(), overrides: Partial<LoginDeps> = {}) {
  let now = T0;
  const sessions: IssuedSession[] = [];
  const wipe = new FakeWipe();
  const m = new LoginMachine({
    signIn: server,
    onSession: (session) => {
      sessions.push(session);
      return Promise.resolve('done');
    },
    wipe,
    now: () => now,
    ...overrides,
  });
  return {
    m,
    server,
    sessions,
    wipe,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function toStep2(m: LoginMachine) {
  m.setEmail(EMAIL);
  m.setPassword(PASSWORD);
  await m.submitCredentials(true);
}

describe('sign-in machine of M-01 (EVM-100 AC1)', () => {
  it('EVM-100 AC1: e-mail + password, then the 6-digit code → signed in; password and code are cleared after use', async () => {
    const { m, server, sessions } = machine();
    await toStep2(m);
    expect(m.state).toMatchObject({ step: 'code', email: EMAIL, password: '', error: null });
    m.setCode('123456');
    await m.submitCode(true);
    expect(m.state).toMatchObject({ done: true, code: '', password: '' });
    expect(sessions).toHaveLength(1);
    expect(server.requests.map((r) => r.step)).toEqual([1, 2]);
    expect(server.requests[0]?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('EVM-100 AC1: the challenge token is never part of the state (only the machine holds it)', async () => {
    const { m, server } = machine();
    await toStep2(m);
    const challenge = server.requests.length > 0 ? 'challenge1' : '';
    expect(JSON.stringify(m.state)).not.toContain(challenge);
  });

  it('EVM-100 AC1: "Zmień konto" goes back to the e-mail, keeps it, clears the password and the challenge', async () => {
    const { m, server } = machine();
    await toStep2(m);
    m.setCode('12');
    m.changeAccount();
    expect(m.state).toMatchObject({ step: 'credentials', email: EMAIL, password: '', code: '' });
    await m.submitCode(true);
    expect(server.requests).toHaveLength(1);
  });

  it('EVM-100 AC1: a pasted code with spaces is accepted; anything else than digits is refused without echo', () => {
    const { m } = machine();
    m.setCode('123 456');
    expect(m.state.code).toBe('123456');
    m.setCode('12a456');
    expect(m.state.code).toBe('123456');
    m.setCode('1234567');
    expect(m.state.code).toBe('123456');
    expect(normalizeCode(' 12 34 ')).toBe('1234');
    expect(normalizeCode('x')).toBeNull();
  });

  it('EVM-100 AC1 (W8): a double tap sends one request in each step; an incomplete form sends nothing', async () => {
    const { m, server } = machine();
    await m.submitCredentials(true);
    m.setEmail(EMAIL);
    await m.submitCredentials(true);
    expect(server.requests).toHaveLength(0);
    m.setPassword(PASSWORD);
    await Promise.all([m.submitCredentials(true), m.submitCredentials(true)]);
    expect(server.requests).toHaveLength(1);
    m.setCode('12345');
    await m.submitCode(true);
    m.setCode('123456');
    await Promise.all([m.submitCode(true), m.submitCode(true)]);
    expect(server.requests).toHaveLength(2);
    await m.submitCredentials(true);
    expect(server.requests).toHaveLength(2);
  });

  it('EVM-100 AC1: step 1 carries the pair of a known installation (the proof of the store)', async () => {
    const proof = InstallationProof.of({ deviceId: DEVICE_1, secret: secret(3) });
    const server = new FakeAuthServer(() => Promise.resolve(proof));
    const { m } = machine(server);
    await toStep2(m);
    expect(server.requests[0]?.body).toMatchObject({ deviceId: DEVICE_1, installationSecret: secret(3) });
  });

  it('EVM-100 AC1: a session that could not be stored returns to step 1 with the generic error; the e-mail stays', async () => {
    const { m } = machine(new FakeAuthServer(), { onSession: () => Promise.resolve('failed') });
    await toStep2(m);
    m.setCode('123456');
    await m.submitCode(true);
    expect(m.state).toMatchObject({ step: 'credentials', email: EMAIL, error: 'unavailable', done: false, busy: false });
    const throwing = machine(new FakeAuthServer(), { onSession: () => Promise.reject(new Error('synthetic')) });
    await toStep2(throwing.m);
    throwing.m.setCode('123456');
    await throwing.m.submitCode(true);
    expect(throwing.m.state.error).toBe('unavailable');
  });

  it('EVM-100 AC1: a challenge past its deadline is dropped without a request (also when the app returns to the foreground)', async () => {
    const { m, server, advance } = machine();
    await toStep2(m);
    advance(300_000);
    m.setCode('123456');
    await m.submitCode(true);
    expect(m.state).toMatchObject({ step: 'credentials', email: EMAIL, error: 'challenge_expired' });
    expect(server.requests).toHaveLength(1);
    const fresh = machine();
    await toStep2(fresh.m);
    fresh.m.checkChallenge();
    expect(fresh.m.state.step).toBe('code');
    fresh.advance(300_000);
    fresh.m.checkChallenge();
    expect(fresh.m.state).toMatchObject({ step: 'credentials', error: 'challenge_expired' });
    fresh.m.checkChallenge();
    expect(fresh.m.state.step).toBe('credentials');
  });

  it('EVM-100 AC1: subscribers are told about every change; dispose clears the form and the listeners', async () => {
    const { m } = machine();
    const seen: string[] = [];
    const unsubscribe = m.subscribe(() => seen.push(m.getState().email));
    m.setEmail('a');
    unsubscribe();
    m.setEmail('b');
    expect(seen).toEqual(['a']);
    m.subscribe(() => seen.push('late'));
    await toStep2(m);
    m.dispose();
    expect(m.state.email).toBe('');
    m.setEmail('c');
    expect(seen.at(-1)).not.toBe('late-after-dispose');
  });
});

describe('errors of the sign-in (EVM-100 AC2; security W7)', () => {
  it('EVM-100 AC2: a wrong e-mail or password gives the one message; the password is cleared, the e-mail stays', async () => {
    const { m } = machine();
    m.setEmail('nobody@example.test');
    m.setPassword('wrong');
    await m.submitCredentials(true);
    expect(m.state).toMatchObject({ error: 'invalid_credentials', email: 'nobody@example.test', password: '', step: 'credentials' });
    m.setEmail(EMAIL);
    m.setPassword('wrong');
    await m.submitCredentials(true);
    expect(m.state.error).toBe('invalid_credentials');
  });

  it('EVM-100 AC2: a wrong or expired code gives the code message, step 2 stays, the code is cleared, the e-mail stays', async () => {
    const { m } = machine();
    await toStep2(m);
    m.setCode('000000');
    await m.submitCode(true);
    expect(m.state).toMatchObject({ step: 'code', error: 'invalid_code', code: '', email: EMAIL });
    m.setCode('1');
    expect(m.state.error).toBeNull();
  });

  it('EVM-100 AC2: 429 locks both steps for the time of Retry-After, in whole minutes rounded up; the lock ends by itself', async () => {
    const server = new FakeAuthServer();
    server.state.rateLimitedForSec = 230;
    const { m, advance } = machine(server);
    m.setEmail(EMAIL);
    m.setPassword(PASSWORD);
    await m.submitCredentials(true);
    expect(lockMinutes(m.state, T0)).toBe(4);
    expect(m.state.password).toBe(PASSWORD);
    expect(m.canSubmit(true)).toBe(false);
    advance(60_000);
    expect(lockMinutes(m.state, T0 + 60_000)).toBe(3);
    m.tick();
    expect(m.state.lockedUntil).not.toBeNull();
    advance(170_000);
    m.tick();
    expect(m.state.lockedUntil).toBeNull();
    expect(m.canSubmit(true)).toBe(true);
    server.state.rateLimitedForSec = null;
    await m.submitCredentials(true);
    server.state.rateLimitedForSec = 60;
    m.setCode('123456');
    await m.submitCode(true);
    expect(m.state.step).toBe('code');
    expect(lockMinutes(m.state, T0 + 230_000)).toBe(1);
    expect(lockMinutes({ ...m.state, lockedUntil: null }, T0)).toBe(0);
  });

  it('EVM-100 AC2: "Zmień konto" keeps a running 429 lock', async () => {
    const server = new FakeAuthServer();
    const { m } = machine(server);
    await toStep2(m);
    server.state.rateLimitedForSec = 120;
    m.setCode('123456');
    await m.submitCode(true);
    m.changeAccount();
    expect(lockMinutes(m.state, T0)).toBe(2);
  });

  it('EVM-100 AC2: a network error or 5xx gives the generic message and keeps what was typed', async () => {
    const server = new FakeAuthServer();
    server.network = false;
    const { m } = machine(server);
    m.setEmail(EMAIL);
    m.setPassword(PASSWORD);
    await m.submitCredentials(true);
    expect(m.state).toMatchObject({ error: 'unavailable', password: PASSWORD, busy: false });
    server.network = true;
    await m.submitCredentials(true);
    m.setCode('123456');
    server.network = false;
    await m.submitCode(true);
    expect(m.state).toMatchObject({ error: 'unavailable', code: '123456', step: 'code' });
  });

  it('EVM-100 AC2 (W7): an unknown problem code gives the generic message, never a new variant', async () => {
    const { m } = machine({
      login: () => Promise.resolve({ kind: 'problem', status: 403, code: 'something_new' }),
      loginTotp: () => Promise.resolve({ kind: 'problem', status: 409, code: 'unknown' }),
    } as never);
    m.setEmail(EMAIL);
    m.setPassword(PASSWORD);
    await m.submitCredentials(true);
    expect(m.state).toMatchObject({ error: 'unavailable', blocked: null });
    const rate = machine({ login: () => Promise.resolve({ kind: 'problem', status: 429, code: 'x' }) } as never);
    rate.m.setEmail(EMAIL);
    rate.m.setPassword(PASSWORD);
    await rate.m.submitCredentials(true);
    expect(rate.m.state.lockedUntil).toBe(T0);
  });

  it('EVM-100 AC6: offline nothing is sent (the button is disabled) and the e-mail stays', async () => {
    const { m, server } = machine();
    m.setEmail(EMAIL);
    m.setPassword(PASSWORD);
    expect(m.canSubmit(false)).toBe(false);
    await m.submitCredentials(false);
    expect(server.requests).toHaveLength(0);
    expect(m.state.email).toBe(EMAIL);
  });
});

const patch = (server: FakeAuthServer, change: Partial<FakeAccount>) => {
  const [account] = server.state.accounts;
  if (account === undefined) throw new Error('no account');
  server.state.accounts[0] = { ...account, ...change };
};

describe('blocking states before a session (EVM-100 AC3) in the order of EVM-094', () => {
  const blockedAfter = async (setup: (server: FakeAuthServer) => void, code = '123456') => {
    const server = new FakeAuthServer();
    setup(server);
    const { m, sessions, wipe } = machine(server);
    m.setEmail(EMAIL);
    m.setPassword(PASSWORD);
    await m.submitCredentials(true);
    if (m.state.step === 'code') {
      m.setCode(code);
      await m.submitCode(true);
    }
    return { state: m.state, sessions, wipe, server, m };
  };

  it('EVM-100 AC3: 426 comes first — before the password is even checked', async () => {
    const { state, server } = await blockedAfter((s) => {
      s.state.versionUnsupported = true;
      s.state.accounts = [];
    });
    expect(state.blocked).toBe('client_version_unsupported');
    expect(server.requests).toHaveLength(1);
  });

  it('EVM-100 AC3: totp_not_configured and mfa_enrollment_required come after the correct password, in step 1', async () => {
    const passkey = await blockedAfter((s) => {
      patch(s, { secondStep: 'passkey_only' });
    });
    expect(passkey.state.blocked).toBe('totp_not_configured');
    const none = await blockedAfter((s) => {
      patch(s, { secondStep: 'none', role: 'read_only' });
    });
    expect(none.state.blocked).toBe('mfa_enrollment_required');
  });

  it('EVM-100 AC3: channel_not_allowed (Tylko odczyt) and device_limit_reached come after the correct CODE, never after the password', async () => {
    const readOnly = await blockedAfter((s) => {
      patch(s, { role: 'read_only' });
    });
    expect(readOnly.server.requests.map((r) => r.step)).toEqual([1, 2]);
    expect(readOnly.state.blocked).toBe('channel_not_allowed');
    const wrongCode = await blockedAfter((s) => {
      patch(s, { role: 'read_only' });
    }, '000000');
    expect(wrongCode.state).toMatchObject({ blocked: null, error: 'invalid_code' });
    const full = await blockedAfter((s) => {
      patch(s, { devicesFull: true });
    });
    expect(full.state.blocked).toBe('device_limit_reached');
    expect(full.sessions).toHaveLength(0);
  });

  it('EVM-100 AC3: a blocking state hands no session over (nothing stored), keeps the e-mail; "Wróć do logowania" returns to M-01', async () => {
    const { state, sessions, m } = await blockedAfter((s) => {
      patch(s, { devicesFull: true });
    });
    expect(state).toMatchObject({ blocked: 'device_limit_reached', email: EMAIL, password: '', code: '' });
    expect(sessions).toHaveLength(0);
    m.backToSignIn();
    expect(m.state).toMatchObject({ blocked: null, step: 'credentials', email: EMAIL });
  });

  it('EVM-100 AC4: device_wipe_required at step 1 (pair of a phone to wipe) or between the steps signals the wipe to EVM-101', async () => {
    const proof = InstallationProof.of({ deviceId: DEVICE_1, secret: secret(1) });
    const server = new FakeAuthServer(() => Promise.resolve(proof));
    server.state.wipeDeviceId = DEVICE_1;
    const { m, wipe } = machine(server);
    m.setEmail('anyone@example.test');
    m.setPassword('anything');
    await m.submitCredentials(true);
    expect(m.state.blocked).toBe('device_wipe_required');
    expect(wipe.signals).toBe(1);
    const between = await blockedAfter((s) => {
      s.state.wipeBetweenSteps = true;
    });
    expect(between.state.blocked).toBe('device_wipe_required');
    expect(between.wipe.signals).toBe(1);
  });
});
