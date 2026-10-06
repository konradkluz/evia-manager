import request, { type Test } from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOCK } from '../../src/platform/tokens.ts';
import { createTestApp, PANEL_ORIGIN, type TestApp } from '../support/app.ts';
import { FixedClock } from '../support/clock.ts';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const CHECK = '/api/v1/auth/activation/check';
const PASSWORD = '/api/v1/auth/activation/password';
const token = 'A'.repeat(43);

const app = async (options: { env?: Record<string, string>; clock?: FixedClock } = {}): Promise<ReturnType<typeof request>> => {
  const { clock } = options;
  current = await createTestApp({
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(clock === undefined ? {} : { configure: (builder) => builder.overrideProvider(CLOCK).useValue(clock) }),
  });
  return request(current.app.getHttpServer());
};

/** A public POST as the panel sends it. */
const sameOriginPost = (server: ReturnType<typeof request>, path: string): Test =>
  server.post(path).set('Origin', PANEL_ORIGIN).set('Sec-Fetch-Site', 'same-origin').set('Content-Type', 'application/json');

describe('request pipeline: methods, bodies and media types (EVM-016 AC4, AC5; SR-INPUT-06)', () => {
  it('EVM-016 AC5 TRACE and unknown methods are rejected before routing with 405 and never echo the request', async () => {
    const server = await app();
    const trace = await server.trace('/api/health').set('X-Secret', 'do-not-echo');
    expect(trace.status).toBe(405);
    expect(trace.body).toMatchObject({ code: 'method_not_allowed', status: 405 });
    expect(trace.text).not.toContain('do-not-echo');
  });

  it('EVM-016 AC5 a public operation with a body that is not application/json is 415, also with a valid origin', async () => {
    const server = await app();
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonx', 'multipart/form-data']) {
      const response = await server
        .post(CHECK)
        .set('Origin', PANEL_ORIGIN)
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Content-Type', contentType)
        .send(`token=${token}`);
      expect(response.status, contentType).toBe(415);
      expect(response.body, contentType).toMatchObject({ code: 'unsupported_media_type' });
    }
  });

  it('EVM-016 AC5 an anonymous body over 8 KB is 413 on a public operation; the limit of a session is 1 MB', async () => {
    const server = await app();
    const response = await sameOriginPost(server, CHECK).send(JSON.stringify({ token, padding: 'x'.repeat(9000) }));
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 'payload_too_large' });
    const accepted = await sameOriginPost(server, CHECK).send(JSON.stringify({ token, padding: 'x'.repeat(4000) }));
    expect(accepted.status).toBe(400);
    expect(accepted.body).toMatchObject({ code: 'validation_failed', errors: [{ pointer: '/padding', code: 'unknown_field' }] });
  });

  it('EVM-016 AC5 malformed JSON on a public operation is 400 malformed_json without the parser message', async () => {
    const server = await app();
    const response = await sameOriginPost(server, CHECK).send('{"token": ');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'malformed_json' });
    expect(response.text).not.toMatch(/Unexpected|position/);
  });

  it('EVM-016 AC4 __proto__, constructor and extra fields in a body are validation errors, never prototype pollution', async () => {
    const server = await app();
    for (const body of [
      `{"token":"${token}","__proto__":{"admin":true}}`,
      `{"token":"${token}","constructor":{"prototype":{"admin":true}}}`,
    ]) {
      const response = await sameOriginPost(server, CHECK).send(body);
      expect(response.status, body).toBe(400);
      expect(response.body, body).toMatchObject({ code: 'validation_failed' });
    }
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it('EVM-016 AC4 an unknown or repeated query parameter on a public operation is 400 (duplicate_parameter, unknown_parameter)', async () => {
    const server = await app();
    const unknown = await sameOriginPost(server, `${CHECK}?debug=1`).send(JSON.stringify({ token: 'short' }));
    expect(unknown.body).toMatchObject({ code: 'unknown_parameter' });
    const repeated = await sameOriginPost(server, `${CHECK}?a=1&a=2`).send(JSON.stringify({ token: 'short' }));
    expect(repeated.body).toMatchObject({ code: 'unknown_parameter' });
    expect(unknown.status).toBe(400);
  });

  it('EVM-016 AC5 the token never travels in the query: even a valid-looking token in the URL is just an unknown parameter', async () => {
    const server = await app();
    const response = await sameOriginPost(server, `${CHECK}?token=${token}`).send(JSON.stringify({ token }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'unknown_parameter' });
    expect(response.text).not.toContain(token);
  });
});

describe('CSRF of public mutations (EVM-016 AC5; SR-SESS-10, ASVS V3.5.1-3)', () => {
  const attempts: Array<[string, Record<string, string>]> = [
    ['no Origin and no Sec-Fetch-Site', {}],
    ['no Origin', { 'Sec-Fetch-Site': 'same-origin' }],
    ['no Sec-Fetch-Site', { Origin: PANEL_ORIGIN }],
    ['foreign Origin', { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'same-origin' }],
    ['subdomain of the panel as Origin', { Origin: 'https://evil.panel.evia.test', 'Sec-Fetch-Site': 'same-origin' }],
    ['null Origin', { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }],
    ['cross-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }],
    ['same-site fetch', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'same-site' }],
    ['user-initiated navigation', { Origin: PANEL_ORIGIN, 'Sec-Fetch-Site': 'none' }],
    ['Origin with a path', { Origin: `${PANEL_ORIGIN}/`, 'Sec-Fetch-Site': 'same-origin' }],
  ];

  it.each(attempts)('EVM-016 AC5 %s gives 403 csrf_failed before the body is even looked at', async (_label, headers) => {
    const server = await app();
    for (const path of [CHECK, PASSWORD]) {
      const response = await server
        .post(path)
        .set(headers)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ token: 'short' }));
      expect(response.status, path).toBe(403);
      expect(response.body, path).toMatchObject({ code: 'csrf_failed' });
    }
  });

  it('EVM-016 AC5 no CORS headers are ever sent and a preflight from another origin gets nothing (CORS is off, ADR-0004)', async () => {
    const server = await app();
    const preflight = await server
      .options(CHECK)
      .set('Origin', 'https://attacker.invalid')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(preflight.status).toBe(401);
    expect(Object.keys(preflight.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    const post = await server.post(CHECK).set('Origin', 'https://attacker.invalid').set('Content-Type', 'application/json').send('{}');
    expect(Object.keys(post.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });
});

describe('per-IP limits on the wire (EVM-016 AC5; SR-API-02, P10)', () => {
  it('EVM-016 AC5 the 21st attempt to set a password within a minute is 429 with Retry-After; the minute after it is open again', async () => {
    const clock = new FixedClock('2026-10-01T08:00:00Z');
    const server = await app({ clock });
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await sameOriginPost(server, PASSWORD).send(JSON.stringify({ token: 'short', password: 'x' }));
      expect(response.status, `attempt ${attempt}`).toBe(400);
    }
    const limited = await sameOriginPost(server, PASSWORD).send(JSON.stringify({ token: 'short', password: 'x' }));
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(Number(limited.headers['retry-after'])).toBe(60);
    clock.advance(61_000);
    expect((await sameOriginPost(server, PASSWORD).send(JSON.stringify({ token: 'short', password: 'x' }))).status).toBe(400);
  });

  it('EVM-016 AC5 other anonymous operations have 60 per minute, counted apart from the stricter bucket', async () => {
    const server = await app({ clock: new FixedClock('2026-10-01T08:00:00Z') });
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      expect((await sameOriginPost(server, CHECK).send(JSON.stringify({ token: 'short' }))).status, `attempt ${attempt}`).toBe(400);
    }
    expect((await sameOriginPost(server, CHECK).send(JSON.stringify({ token: 'short' }))).status).toBe(429);
    expect((await sameOriginPost(server, PASSWORD).send(JSON.stringify({ token: 'short', password: 'x' }))).status).toBe(400);
  });

  it('EVM-016 AC5 a forged X-Forwarded-For does not move a client to another bucket when no proxy is trusted (CWE-348)', async () => {
    const server = await app({ clock: new FixedClock('2026-10-01T08:00:00Z') });
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await sameOriginPost(server, PASSWORD)
        .set('X-Forwarded-For', `203.0.113.${attempt}`)
        .send(JSON.stringify({ token: 'short', password: 'x' }));
    }
    const response = await sameOriginPost(server, PASSWORD)
      .set('X-Forwarded-For', '203.0.113.99')
      .send(JSON.stringify({ token: 'short', password: 'x' }));
    expect(response.status).toBe(429);
  });

  it('EVM-016 AC5 behind a trusted proxy the forwarded client address is the one that is counted', async () => {
    const server = await app({
      env: { TRUSTED_PROXIES: '127.0.0.1,::1,::ffff:127.0.0.1' },
      clock: new FixedClock('2026-10-01T08:00:00Z'),
    });
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const response = await sameOriginPost(server, PASSWORD)
        .set('X-Forwarded-For', `203.0.113.${attempt}`)
        .send(JSON.stringify({ token: 'short', password: 'x' }));
      expect(response.status, `client ${attempt}`).toBe(400);
    }
    const sameClient = await sameOriginPost(server, PASSWORD)
      .set('X-Forwarded-For', '203.0.113.1')
      .send(JSON.stringify({ token: 'short', password: 'x' }));
    expect(sameClient.status).toBe(400);
  });

  it('EVM-016 AC5 every request counts towards 1200 per minute, also the ones that end in 401', async () => {
    const server = await app({ clock: new FixedClock('2026-10-01T08:00:00Z') });
    for (let attempt = 1; attempt <= 1200; attempt += 1) await server.get('/api/v1/nothing');
    const response = await server.get('/api/v1/nothing');
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ code: 'rate_limited' });
    expect(response.headers['retry-after']).toBeDefined();
  });
});
