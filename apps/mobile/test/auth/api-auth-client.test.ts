import { createHttpAuthClient, type HttpAuthClientOptions } from '../../src/api/auth-client';
import { Challenge, revealChallenge, revealSession } from '../../src/auth/opaque';
import { DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS, parseRetryAfter } from '../../src/auth/retry-after';
import { InstallationProof } from '../../src/storage/installation-proof';
import { DEVICE_1, T0, challengeToken, problemBody, secret, sessionBody, token } from './fixtures';

const DEVICE = { model: 'Pixel 8', osVersion: '15', securityPatch: '2026-09-05' };

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function client(answers: (Response | Error | 'hang')[], overrides: Partial<HttpAuthClientOptions> = {}) {
  const sent: Sent[] = [];
  const instance = createHttpAuthClient({
    baseUrl: 'https://api.example.test',
    allowLocalHttp: false,
    platform: 'android',
    appVersion: '0.4.0',
    device: () => Promise.resolve(DEVICE),
    installationProof: () => Promise.resolve(null),
    now: () => T0,
    timeoutMs: 1000,
    fetch: async (request) => {
      const text = await request.text();
      sent.push({ url: request.url, method: request.method, headers: request.headers, body: text === '' ? undefined : JSON.parse(text) });
      const next = answers.shift();
      if (next === undefined) throw new Error('no scripted answer');
      if (next === 'hang') return new Promise<Response>(() => undefined);
      if (next instanceof Error) throw next;
      return next;
    },
    ...overrides,
  });
  return { instance, sent };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const challengeBody = { challengeToken: challengeToken(1), challengeExpiresAt: new Date(T0 + 300_000).toISOString() };

describe('HTTP adapter of the mobile sign-in (EVM-100 AC1, AC2; contract EVM-090)', () => {
  it('EVM-100 AC1: step 1 sends e-mail, password and the description of the phone, with the compatibility headers, and no pair for a new device', async () => {
    const { instance, sent } = client([json(200, challengeBody)]);
    const result = await instance.login({ email: 'jan@example.test', password: 'synthetic-password' });
    expect(result.kind).toBe('ok');
    expect(sent[0]?.url).toBe('https://api.example.test/api/v1/auth/mobile/login');
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.body).toEqual({ email: 'jan@example.test', password: 'synthetic-password', device: DEVICE });
    expect(sent[0]?.headers.get('X-Client-Platform')).toBe('android');
    expect(sent[0]?.headers.get('X-Client-Version')).toBe('0.4.0');
    expect(sent[0]?.headers.get('Authorization')).toBeNull();
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(revealChallenge(result.value)).toBe(challengeToken(1));
    expect(result.value.expiresAt).toBe(T0 + 300_000);
  });

  it('EVM-100 AC1: a known installation adds the pair deviceId + installation secret to the body of step 1', async () => {
    const proof = InstallationProof.of({ deviceId: DEVICE_1, secret: secret(7) });
    const { instance, sent } = client([json(200, challengeBody)], { installationProof: () => Promise.resolve(proof) });
    await instance.login({ email: 'jan@example.test', password: 'p' });
    expect(sent[0]?.body).toMatchObject({ deviceId: DEVICE_1, installationSecret: secret(7) });
  });

  it('EVM-100 AC1: a proof that cannot be read sends no pair (a new device), the sign-in goes on', async () => {
    const { instance, sent } = client([json(200, challengeBody)], { installationProof: () => Promise.reject(new Error('synthetic')) });
    expect((await instance.login({ email: 'a@example.test', password: 'p' })).kind).toBe('ok');
    expect(sent[0]?.body).not.toHaveProperty('deviceId');
  });

  it('EVM-100 AC1: the challenge deadline is never later than 10 minutes on the phone, and an invalid one is already expired', async () => {
    const far = { ...challengeBody, challengeExpiresAt: new Date(T0 + 86_400_000).toISOString() };
    const { instance } = client([json(200, far)]);
    const result = await instance.login({ email: 'a@example.test', password: 'p' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.value.expiresAt).toBe(T0 + 600_000);
  });

  it('EVM-100 AC1: step 2 sends exactly {challengeToken, code} and returns an opaque session parsed by the contract schema', async () => {
    const { instance, sent } = client([json(200, sessionBody())]);
    const result = await instance.loginTotp(Challenge.of(challengeToken(2), T0 + 1000), '123456');
    expect(sent[0]?.url).toBe('https://api.example.test/api/v1/auth/mobile/login/totp');
    expect(sent[0]?.body).toEqual({ challengeToken: challengeToken(2), code: '123456' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(revealSession(result.value)).toEqual({
      deviceId: DEVICE_1,
      installationSecret: secret(1),
      accessToken: token('access-1'),
      accessTokenTtlMs: 15 * 60_000,
      refreshToken: token('refresh-1'),
      serverTime: T0,
      user: { id: expect.any(String) as string, displayName: 'Piotr Testowy', role: 'editor' },
    });
    expect(JSON.stringify(result)).not.toContain(token('access-1'));
  });

  it('EVM-100 AC1: a challenge not created by the adapter is never sent', async () => {
    const { instance, sent } = client([]);
    expect(await instance.loginTotp(Object.create(Challenge.prototype) as Challenge, '123456')).toEqual({ kind: 'unavailable' });
    expect(sent).toHaveLength(0);
  });

  it('EVM-100 AC5: refresh sends the refresh token in the body only; logout sends the access token as Bearer and accepts 204', async () => {
    const { instance, sent } = client([json(200, sessionBody({ n: 2, withSecret: false })), new Response(null, { status: 204 })]);
    const refreshed = await instance.refresh(token('refresh-1'));
    expect(sent[0]?.url).toBe('https://api.example.test/api/v1/auth/mobile/token');
    expect(sent[0]?.body).toEqual({ refreshToken: token('refresh-1') });
    if (refreshed.kind !== 'ok') throw new Error('expected ok');
    expect(revealSession(refreshed.value)?.installationSecret).toBeUndefined();
    expect(await instance.logout(token('access-2'))).toEqual({ kind: 'ok', value: null });
    expect(sent[1]?.url).toBe('https://api.example.test/api/v1/auth/mobile/logout');
    expect(sent[1]?.headers.get('Authorization')).toBe(`Bearer ${token('access-2')}`);
    expect(sent[1]?.body).toBeUndefined();
  });

  it('EVM-100 AC2: a 4xx problem becomes its code; a malformed or unknown body becomes `unknown`, never a message', async () => {
    const { instance } = client([
      json(401, problemBody(401, 'invalid_credentials')),
      json(403, { code: 'Not A Code', detail: 'secret detail of the server' }),
      new Response('<html>proxy</html>', { status: 400 }),
    ]);
    expect(await instance.login({ email: 'a@example.test', password: 'p' })).toEqual({
      kind: 'problem',
      status: 401,
      code: 'invalid_credentials',
    });
    const malformed = await instance.login({ email: 'a@example.test', password: 'p' });
    expect(malformed).toEqual({ kind: 'problem', status: 403, code: 'unknown' });
    expect(JSON.stringify(malformed)).not.toContain('secret detail');
    expect(await instance.login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'problem', status: 400, code: 'unknown' });
  });

  it('EVM-100 AC2: 429 carries the wait of Retry-After (seconds), every 5xx, a network error and a timeout are `unavailable`', async () => {
    jest.useFakeTimers();
    try {
      const { instance } = client([
        json(429, problemBody(429, 'too_many_requests'), { 'Retry-After': '230' }),
        json(503, problemBody(503, 'service_unavailable')),
        new TypeError('Network request failed for https://api.example.test with password'),
        'hang',
      ]);
      expect(await instance.login({ email: 'a@example.test', password: 'p' })).toEqual({
        kind: 'problem',
        status: 429,
        code: 'too_many_requests',
        retryAfterMs: 230_000,
      });
      expect(await instance.login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'unavailable' });
      expect(await instance.refresh(token('refresh-1'))).toEqual({ kind: 'unavailable' });
      const hanging = instance.logout(token('access-1'));
      await jest.advanceTimersByTimeAsync(1000);
      expect(await hanging).toEqual({ kind: 'unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-100 AC1 (SR-MOB-10): an answer that does not match the contract is `unavailable` (no token of a malformed answer is used)', async () => {
    const short = { ...sessionBody(), refreshToken: 'short' };
    const { instance } = client([
      json(200, { challengeToken: 'x' }),
      json(200, short),
      json(200, { ...sessionBody(), serverTime: 'yesterday' }),
      new Response('not json', { status: 200 }),
      json(200, {}),
    ]);
    expect(await instance.login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'unavailable' });
    expect(await instance.loginTotp(Challenge.of(challengeToken(1), T0), '123456')).toEqual({ kind: 'unavailable' });
    expect(await instance.refresh(token('r'))).toEqual({ kind: 'unavailable' });
    expect(await instance.refresh(token('r'))).toEqual({ kind: 'unavailable' });
    expect(await instance.logout(token('a'))).toEqual({ kind: 'unavailable' });
  });

  it('EVM-100 (SR-COMM-04): a plain HTTP origin is refused unless the e2e variant allows the local host; nothing is sent', async () => {
    const refused = client([], { baseUrl: 'http://10.0.2.2:8787' });
    expect(await refused.instance.login({ email: 'a@example.test', password: 'p' })).toEqual({ kind: 'unavailable' });
    expect(refused.sent).toHaveLength(0);
    const e2e = client([json(200, challengeBody)], { baseUrl: 'http://10.0.2.2:8787', allowLocalHttp: true });
    expect((await e2e.instance.login({ email: 'a@example.test', password: 'p' })).kind).toBe('ok');
  });

  it('EVM-100 AC2: the default fetch of the platform is used when none is injected', async () => {
    const original = global.fetch;
    const spy = jest.fn(() => Promise.resolve(json(200, challengeBody)));
    global.fetch = spy;
    try {
      const instance = createHttpAuthClient({
        baseUrl: 'https://api.example.test',
        allowLocalHttp: false,
        platform: 'android',
        appVersion: '0.4.0',
        device: () => Promise.resolve(DEVICE),
        installationProof: () => Promise.resolve(null),
      });
      expect((await instance.login({ email: 'a@example.test', password: 'p' })).kind).toBe('ok');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });
});

describe('Retry-After (EVM-100 AC2; security W8)', () => {
  it('EVM-100 AC2: delta seconds and an HTTP-date are read; anything else gives the safe default; the wait is capped', () => {
    expect(parseRetryAfter('120', T0)).toBe(120_000);
    expect(parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(90_000);
    expect(parseRetryAfter(new Date(T0 - 90_000).toUTCString(), T0)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(parseRetryAfter(null, T0)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(parseRetryAfter('-5', T0)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(parseRetryAfter('soon', T0)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(parseRetryAfter('999999', T0)).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter('0', T0)).toBe(0);
  });
});
