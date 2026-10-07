import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createClient, getHealth } from '../src/index.ts';
import { zHealth, zProblem, zSemver } from '../src/zod.ts';

const health = { status: 'ok', minSupportedAppVersion: { android: '1.2.3', ios: '1.0.0' } };

describe('generated client and schemas (EVM-008 AC2)', () => {
  it('EVM-008 AC2 web client is generated from the contract: getHealth calls GET /api/health', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const request = input instanceof Request ? input : new Request(input);
      expect(request.method).toBe('GET');
      expect(new URL(request.url).pathname).toBe('/api/health');
      return new Response(JSON.stringify(health), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    });
    const client = createClient({ baseUrl: 'http://localhost', fetch });
    const result = await getHealth({ client });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual(health);
  });

  it('EVM-008 AC2 the generator input is the bundle of the source specification', () => {
    const bundle = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as { openapi: string; paths: Record<string, unknown> };
    expect(bundle.openapi).toBe('3.1.0');
    expect(Object.keys(bundle.paths)).toEqual([
      '/api/health',
      '/api/v1/auth/activation/check',
      '/api/v1/auth/activation/password',
      '/api/v1/auth/login',
      '/api/v1/auth/login/passkey/options',
      '/api/v1/auth/login/passkey',
      '/api/v1/auth/session',
      '/api/v1/auth/session/extend',
      '/api/v1/auth/logout',
      '/api/v1/account/passkeys/registration-options',
      '/api/v1/account/passkeys',
      '/api/v1/catalog/work-order-templates',
      '/api/v1/catalog/work-order-templates/{templateId}',
      '/api/v1/catalog/service-items',
      '/api/v1/catalog/procedure-templates',
      '/api/v1/catalog/document-kinds',
    ]);
  });

  it('EVM-008 AC2 response schemas tolerate unknown fields (additive v1, ADR-0004)', () => {
    expect(zHealth.parse({ ...health, added: 1 })).toEqual(health);
    expect(zHealth.safeParse({ status: 'ok' }).success).toBe(false);
    expect(
      zProblem.safeParse({ type: '/problems/x', title: 'X', status: 500, code: 'internal_error', traceId: 'a'.repeat(32) }).success,
    ).toBe(true);
  });

  it('EVM-008 AC2 Semver accepts MAJOR.MINOR.PATCH only', () => {
    for (const ok of ['0.0.0', '1.2.3', '10.20.300']) expect(zSemver.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['', '1.2', 'v1.2.3', '1.2.3-beta', '01.2.3', '1.2.3 ', '1.2.3\n'])
      expect(zSemver.safeParse(bad).success, bad).toBe(false);
  });
});
