import { afterEach, describe, expect, it, vi } from 'vitest';
import { headerMiddleware, panelSecurityHeaders, parseMediaOrigin, securityHeadersPlugin } from '../security-headers.ts';

const BUCKET = 'https://evia-staging-media.s3.fr-par.scw.cloud';

const connectSrc = (csp: string | undefined) => (csp ?? '').split('; ').find((directive) => directive.startsWith('connect-src'));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('EVM-044 AC6 CSP connect-src pins the one origin of the media bucket (SR-WEB-01, SR-WEB-08)', () => {
  it("EVM-044 AC6 without the origin connect-src is only 'self'", () => {
    expect(connectSrc(panelSecurityHeaders({ variant: 'strict' })['Content-Security-Policy'])).toBe("connect-src 'self'");
    expect(connectSrc(panelSecurityHeaders({ variant: 'strict', https: true })['Content-Security-Policy'])).toBe("connect-src 'self'");
  });

  it("EVM-044 AC6 with the origin connect-src is 'self' plus exactly that origin, nothing else widens", () => {
    const headers = panelSecurityHeaders({ variant: 'strict', https: true, mediaOrigin: BUCKET });
    expect(connectSrc(headers['Content-Security-Policy'])).toBe(`connect-src 'self' ${BUCKET}`);
    const csp = headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain('upgrade-insecure-requests');
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", 'ws:', ' *']) expect(csp, loose).not.toContain(loose);
    expect(panelSecurityHeaders({ variant: 'dev', mediaOrigin: BUCKET })['Content-Security-Policy']).toBeUndefined();
  });

  it('EVM-044 AC6 the origin must be exactly one https origin: no path, no wildcard, no credentials, no other scheme', () => {
    expect(parseMediaOrigin(undefined)).toBeUndefined();
    expect(parseMediaOrigin('')).toBeUndefined();
    expect(parseMediaOrigin('  ')).toBeUndefined();
    expect(parseMediaOrigin(BUCKET)).toBe(BUCKET);
    expect(parseMediaOrigin('https://bucket.example.test:9000')).toBe('https://bucket.example.test:9000');
    for (const wrong of [
      'http://bucket.example.test',
      'https://*.scw.cloud',
      `${BUCKET}/media`,
      `${BUCKET}/`,
      'https://user:pass@bucket.example.test',
      'bucket.example.test',
      `${BUCKET} https://other.example.test`,
      'https://a.example.test https://b.example.test',
    ])
      expect(() => parseMediaOrigin(wrong), wrong).toThrow('MEDIA_BUCKET_ORIGIN');
  });

  it('EVM-044 AC6 the Vite preview reads MEDIA_BUCKET_ORIGIN from the environment', () => {
    vi.stubEnv('MEDIA_BUCKET_ORIGIN', BUCKET);
    const use = vi.fn();
    (securityHeadersPlugin().configurePreviewServer as (server: unknown) => void)({ middlewares: { use } });
    const headers: Record<string, string> = {};
    (use.mock.calls[0]?.[0] as ReturnType<typeof headerMiddleware>)(
      {},
      { setHeader: (name: string, value: string) => (headers[name] = value) },
      () => undefined,
    );
    expect(connectSrc(headers['Content-Security-Policy'])).toBe(`connect-src 'self' ${BUCKET}`);
  });
});
