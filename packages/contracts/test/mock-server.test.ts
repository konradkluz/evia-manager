import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mockResponse, requestedStatus, startMockServer } from '../src/mock-server.ts';

const bundle: unknown = JSON.parse(readFileSync('dist/openapi.json', 'utf8'));

describe('mock server of the contract (EVM-090 AC7)', () => {
  it('EVM-090 AC7 Prefer: code is parsed defensively', () => {
    expect(requestedStatus(undefined)).toBeUndefined();
    expect(requestedStatus('return=minimal')).toBeUndefined();
    expect(requestedStatus('code=429')).toBe(429);
    expect(requestedStatus('return=minimal, Code = "401"')).toBe(401);
    expect(requestedStatus('wait=5; code=426')).toBe(426);
    for (const bad of ['code=', 'code=abc', 'code=99', 'code=600', 'code=2000', 'code=200 OK']) expect(requestedStatus(bad), bad).toBeNaN();
  });

  it('EVM-090 AC7 the default answer is the 2xx example of the operation, with its headers (no-store)', () => {
    const answer = mockResponse(bundle, 'POST', '/api/v1/auth/mobile/login/totp');
    expect(answer.status).toBe(200);
    expect(answer.headers).toMatchObject({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    expect(JSON.parse(answer.body ?? '')).toMatchObject({ deviceId: '0193a000-0000-7000-8000-0000000000d1', user: { role: 'editor' } });
    expect(mockResponse(bundle, 'POST', '/api/v1/auth/mobile/logout')).toEqual({ status: 204, headers: { 'cache-control': 'no-store' } });
  });

  it('EVM-090 AC7 Prefer: code selects an error of the catalogue, with Retry-After on 429 and the problem+json type', () => {
    const limited = mockResponse(bundle, 'GET', '/api/v1/sync/changes', 'code=429');
    expect(limited.status).toBe(429);
    expect(limited.headers).toMatchObject({ 'content-type': 'application/problem+json', 'retry-after': '1', 'cache-control': 'no-store' });
    expect(JSON.parse(limited.body ?? '')).toMatchObject({ code: 'rate_limited' });
    expect(JSON.parse(mockResponse(bundle, 'GET', '/api/v1/sync/changes', 'code=426').body ?? '')).toMatchObject({
      code: 'client_version_unsupported',
      minSupportedVersion: { android: '1.1.0' },
    });
    // the first example of a response with several codes
    expect(JSON.parse(mockResponse(bundle, 'GET', '/api/v1/sync/changes', 'code=400').body ?? '')).toMatchObject({
      code: 'invalid_cursor',
    });
  });

  it('EVM-090 AC7 a path parameter matches; the literal path wins over the template', () => {
    const snapshot = mockResponse(bundle, 'GET', '/api/v1/sync/work-orders/0193a000-0000-7000-8000-0000000000b1');
    expect(snapshot.status).toBe(200);
    expect(JSON.parse(snapshot.body ?? '')).toHaveProperty('entities');
    expect(mockResponse(bundle, 'GET', '/api/v1/sync/work-orders/x/y').status).toBe(404);
  });

  it('EVM-090 AC7 an unknown path or method answers 404 problem+json', () => {
    for (const [method, path] of [
      ['GET', '/nope'],
      ['DELETE', '/api/v1/sync/changes'],
      ['GET', '/api/v1/sync/changes/extra'],
      ['TRACE', '/api/health'],
    ] as const) {
      const answer = mockResponse(bundle, method, path);
      expect(answer.status, `${method} ${path}`).toBe(404);
      expect(answer.headers['content-type']).toBe('application/problem+json');
      expect(JSON.parse(answer.body ?? '')).toMatchObject({ code: 'not_found', status: 404 });
    }
  });

  it('EVM-090 AC7 an unknown or malformed Prefer: code is a readable 500, not a silent success', () => {
    const unknown = mockResponse(bundle, 'GET', '/api/v1/meta/client-config', 'code=426');
    expect(unknown.status).toBe(500);
    const body = JSON.parse(unknown.body ?? '') as { code: string; title: string; detail: string };
    expect(body.code).toBe('mock_unknown_prefer');
    expect(body.title).toContain('getClientConfig has no 426 response');
    expect(body.detail).toContain('200, 401, 403, 429');
    expect(mockResponse(bundle, 'GET', '/api/v1/meta/client-config', 'code=banana').status).toBe(500);
  });

  it('EVM-090 AC7 a response without an example, and an operation without a success, are reported as 500 (no invented data)', () => {
    const spec = {
      paths: {
        '/a': { get: { operationId: 'getA', responses: { '200': { description: 'x', content: { 'application/json': { schema: {} } } } } } },
        '/b': { get: { operationId: 'getB', responses: { '404': { description: 'x' } } } },
        '/c': { get: { operationId: 'getC', responses: { '200': { description: 'x', content: { 'text/plain': { example: 'hi' } } } } } },
        '/d': { get: { operationId: 'getD', responses: { '200': { $ref: '#/components/responses/D' } } } },
      },
      components: {
        responses: {
          D: {
            description: 'x',
            headers: { 'X-Flag': { example: 'on' }, 'X-None': {} },
            content: { 'application/json': { examples: { one: { value: { ok: true } } } } },
          },
        },
      },
    };
    expect(JSON.parse(mockResponse(spec, 'GET', '/a').body ?? '')).toMatchObject({ code: 'mock_no_example' });
    expect(JSON.parse(mockResponse(spec, 'GET', '/b').body ?? '')).toMatchObject({ code: 'mock_no_success_response' });
    expect(mockResponse(spec, 'GET', '/c').body).toBe('"hi"');
    const referenced = mockResponse(spec, 'GET', '/d');
    expect(referenced.headers).toEqual({ 'x-flag': 'on', 'content-type': 'application/json' });
    expect(JSON.parse(referenced.body ?? '')).toEqual({ ok: true });
    expect(mockResponse({}, 'GET', '/').status).toBe(404);
  });

  it('EVM-090 AC7 the server listens on 127.0.0.1 and an ephemeral port, serves the examples over HTTP, ignores the request body and echoes nothing of it', async () => {
    const mock = await startMockServer(bundle);
    try {
      expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const ok = await fetch(`${mock.url}/api/v1/auth/mobile/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ email: 'secret-probe@example.test', password: 'SECRET-PROBE' }),
      });
      const text = await ok.text();
      expect(ok.status).toBe(200);
      expect(text).not.toContain('SECRET-PROBE');
      expect(text).not.toContain('secret-probe');
      const wipe = await fetch(`${mock.url}/api/v1/devices/current/wipe-confirmation?x=1`, {
        method: 'POST',
        headers: { prefer: 'code=401' },
      });
      expect(wipe.status).toBe(401);
      expect(wipe.headers.get('content-type')).toBe('application/problem+json');
      expect((await fetch(`${mock.url}/unknown`)).status).toBe(404);
      expect((await fetch(`${mock.url}/api/health`, { headers: { prefer: 'code=777' } })).status).toBe(500);
    } finally {
      await mock.close();
    }
    await expect(fetch(`${mock.url}/api/health`)).rejects.toThrow();
  });

  it('EVM-090 AC7 the mock is not part of the main entry point of the package (it cannot reach an application bundle)', () => {
    const index = readFileSync('src/index.ts', 'utf8');
    expect(index).not.toMatch(/mock/i);
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { exports: Record<string, unknown> };
    expect(Object.keys(manifest.exports)).toContain('./mock-server');
    expect(readFileSync('tsconfig.build.json', 'utf8')).toContain('src/mock-server.ts');
  });
});
