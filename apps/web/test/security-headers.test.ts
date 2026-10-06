import { describe, expect, it, vi } from 'vitest';
import { headerMiddleware, panelSecurityHeaders, securityHeadersPlugin } from '../security-headers.ts';

const P11_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

describe('panel security headers (EVM-008 AC4; policies.md § P11, SR-WEB-01, SR-WEB-08)', () => {
  it('EVM-008 AC4 panel security headers include strict CSP: P11 without bucket and Sentry hosts, no unsafe sources', () => {
    const headers = panelSecurityHeaders({ variant: 'strict' });
    expect(headers).toEqual({ ...COMMON, 'Content-Security-Policy': P11_CSP });
    const csp = headers['Content-Security-Policy'] ?? '';
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", 'ws:', 'http:', 'https:', '*']) expect(csp, loose).not.toContain(loose);
  });

  it('EVM-008 AC4 behind HTTPS (EVM-076) the strict variant adds upgrade-insecure-requests and HSTS of P11', () => {
    const headers = panelSecurityHeaders({ variant: 'strict', https: true });
    expect(headers['Content-Security-Policy']).toBe(`${P11_CSP}; upgrade-insecure-requests`);
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('EVM-008 AC4 the dev variant (vite dev only) keeps every header except CSP', () => {
    expect(panelSecurityHeaders({ variant: 'dev' })).toEqual(COMMON);
  });

  it('EVM-008 AC4 the middleware sets the headers on every response and passes the request on', () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    headerMiddleware({ A: '1', B: '2' })({}, { setHeader }, next);
    expect(setHeader.mock.calls).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('EVM-008 AC4 the Vite plugin applies the strict variant to vite preview and the dev variant to vite dev', () => {
    const plugin = securityHeadersPlugin();
    const headersOf = (hook: unknown): Record<string, string> => {
      const use = vi.fn();
      (hook as (server: unknown) => void)({ middlewares: { use } });
      const headers: Record<string, string> = {};
      (use.mock.calls[0]?.[0] as ReturnType<typeof headerMiddleware>)(
        {},
        { setHeader: (name: string, value: string) => (headers[name] = value) },
        () => undefined,
      );
      return headers;
    };
    expect(headersOf(plugin.configurePreviewServer)).toEqual(panelSecurityHeaders({ variant: 'strict' }));
    expect(headersOf(plugin.configureServer)).toEqual(panelSecurityHeaders({ variant: 'dev' }));
  });
});
