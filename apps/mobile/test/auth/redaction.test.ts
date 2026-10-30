import { createHttpAuthClient } from '../../src/api/auth-client';
import { LoginMachine } from '../../src/auth/login-machine';
import { Challenge, IssuedSession, revealChallenge, revealSession } from '../../src/auth/opaque';
import { checkpoint, parseSessionMeta, sessionEndVariant } from '../../src/auth/session-meta';
import { InstallationProof } from '../../src/storage/installation-proof';
import { FakeAuthServer } from './fake-auth-server';
import { FakeClock, FakeWipe, issued, newPhone, problem, signedIn, start } from './fakes';
import { DEVICE_1, T0, USER_A, challengeToken, secret, token } from './fixtures';

/** Every secret of the sign-in (security W5): none of them may appear in a log, a state, an error or a serialisation. */
const SECRETS = [
  'synthetic-password',
  '123456',
  challengeToken(1),
  token('access-1'),
  token('refresh-1'),
  token('access-2'),
  token('refresh-2'),
  secret(1),
  secret(7),
];

const CONSOLE = ['log', 'warn', 'error', 'info', 'debug'] as const;

function leaked(text: string): string[] {
  return SECRETS.filter((value) => text.includes(value));
}

describe('redaction of the sign-in (EVM-100 AC2; security W5, SR-LOG-02, SR-LOG-08)', () => {
  it('EVM-100 AC2: the opaque carriers serialise to a constant — challenge, session, installation proof', () => {
    const challenge = Challenge.of(challengeToken(1), T0);
    const session = issued({ n: 1 });
    const proof = InstallationProof.of({ deviceId: DEVICE_1, secret: secret(7) });
    for (const value of [challenge, session, proof]) {
      const shown = [
        JSON.stringify(value),
        String(value),
        value.toString(),
        JSON.stringify({ value }),
        JSON.stringify(Object.entries(value)),
      ];
      expect(leaked(shown.join('|'))).toEqual([]);
    }
    expect(revealChallenge(challenge)).toBe(challengeToken(1));
    expect(revealSession(session)?.refreshToken).toBe(token('refresh-1'));
    expect(revealChallenge(Object.create(Challenge.prototype) as Challenge)).toBeNull();
    expect(revealSession(Object.create(IssuedSession.prototype) as IssuedSession)).toBeNull();
  });

  it('EVM-100 AC2: a whole sign-in with failures logs nothing and keeps no secret in the state of the machine', async () => {
    const spies = CONSOLE.map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
    try {
      const server = new FakeAuthServer(() => Promise.resolve(InstallationProof.of({ deviceId: DEVICE_1, secret: secret(7) })));
      const machine = new LoginMachine({ signIn: server, onSession: () => Promise.resolve('done'), wipe: new FakeWipe(), now: () => T0 });
      const states: string[] = [];
      machine.subscribe(() => states.push(JSON.stringify(machine.getState())));
      machine.setEmail('jan@example.test');
      machine.setPassword('wrong-password');
      await machine.submitCredentials(true);
      machine.setPassword('synthetic-password');
      await machine.submitCredentials(true);
      machine.setCode('000000');
      await machine.submitCode(true);
      machine.setCode('123456');
      await machine.submitCode(true);
      // while typed a value is in the state; after the verdict of the server it is gone, and the challenge never was there
      expect(leaked(JSON.stringify(machine.getState()))).toEqual([]);
      expect(states.join('\n')).not.toContain(challengeToken(1));
      expect(states.join('\n')).not.toContain(secret(7));
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-100 AC2: the session owner logs nothing and its failures carry no token', async () => {
    const spies = CONSOLE.map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
    try {
      const phone = newPhone();
      const rig = await signedIn(phone);
      rig.client.refreshScript.push(problem(401, 'session_revoked'));
      const events: unknown[] = [];
      rig.owner.onSessionEnded((event) => events.push(event));
      await rig.owner.refresh();
      expect(leaked(JSON.stringify(events))).toEqual([]);
      expect(leaked(JSON.stringify(rig.owner))).toEqual([]);
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-100 AC2: the HTTP adapter drops the error of fetch (which can name the body) and never returns a body or a detail', async () => {
    const spies = CONSOLE.map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
    try {
      const client = createHttpAuthClient({
        baseUrl: 'https://api.example.test',
        allowLocalHttp: false,
        platform: 'android',
        appVersion: '0.4.0',
        device: () => Promise.resolve({ model: 'Pixel 8', osVersion: '15', securityPatch: '2026-09-05' }),
        installationProof: () => Promise.resolve(InstallationProof.of({ deviceId: DEVICE_1, secret: secret(7) })),
        fetch: () => Promise.reject(new Error(`failed: {"password":"synthetic-password","installationSecret":"${secret(7)}"}`)),
      });
      const outcomes = [
        await client.login({ email: 'jan@example.test', password: 'synthetic-password' }),
        await client.refresh(token('refresh-1')),
        await client.logout(token('access-1')),
      ];
      expect(leaked(JSON.stringify(outcomes))).toEqual([]);
      expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-100 AC1 (W10): the stored session record has no e-mail and no token', async () => {
    const phone = newPhone();
    await signedIn(phone);
    const meta = phone.slots.get('sessionMeta') ?? '';
    expect(leaked(meta)).toEqual([]);
    expect(meta).not.toMatch(/@|token|secret/i);
    expect(Object.keys(JSON.parse(meta) as object).sort()).toEqual(['displayName', 'lastContact', 'role', 'started', 'userId', 'v']);
  });
});

describe('session record (EVM-100 AC4, AC5)', () => {
  const clock = new FakeClock();
  const record = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      userId: USER_A,
      displayName: 'Piotr Testowy',
      role: 'editor',
      started: checkpoint(T0, clock),
      lastContact: checkpoint(T0, clock),
      ...patch,
    });

  it('EVM-100 AC1: only a complete, well-formed record is accepted', () => {
    expect(parseSessionMeta(record())?.userId).toBe(USER_A);
    for (const bad of [
      null,
      'not json',
      'null',
      '"text"',
      record({ v: 2 }),
      record({ userId: '' }),
      record({ userId: 'x'.repeat(65) }),
      record({ userId: 7 }),
      record({ displayName: 'x'.repeat(201) }),
      record({ displayName: null }),
      record({ role: 'owner' }),
      record({ started: {} }),
      record({ lastContact: null }),
    ]) {
      expect(parseSessionMeta(bad)).toBeNull();
    }
  });

  it('EVM-100 AC4: a reason sent by the server wins over the rule of the clock; without a record the variant is "Wylogowano"', () => {
    const meta = parseSessionMeta(record());
    expect(sessionEndVariant(meta, clock, 'expired')).toBe('session_expired');
    expect(sessionEndVariant(meta, clock, 'revoked')).toBe('session_revoked');
    expect(sessionEndVariant(null, clock)).toBe('session_revoked');
    expect(sessionEndVariant(meta, clock)).toBe('session_revoked');
  });

  it('EVM-100 AC5: the owner reports the user, the unsent items and nothing without a session', async () => {
    const phone = newPhone();
    const empty = start(phone);
    expect(await empty.owner.unsentItemCount()).toBe(0);
    const rig = await signedIn(phone);
    phone.queue = 4;
    expect(await rig.owner.unsentItemCount()).toBe(4);
    phone.faults.set('get:refreshToken', 'fail');
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
  });
});
