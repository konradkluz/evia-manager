import { afterEach, describe, expect, it, vi } from 'vitest';
import { headerMiddleware, panelSecurityHeaders, parseMediaOrigin, securityHeadersPlugin } from '../security-headers.ts';

const BUCKET = 'https://evia-staging-media.s3.fr-par.scw.cloud';

const connectSrc = (csp: string | undefined) => (csp ?? '').split('; ').find((directive) => directive.startsWith('connect-src'));

const directive = (csp: string | undefined, name: string) => (csp ?? '').split('; ').find((entry) => entry.startsWith(name));

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

  it("EVM-046 AC4 media-src gets the same ONE origin (a <video> plays the preview from a signed address of the bucket); without it media-src stays 'self' blob:", () => {
    expect(directive(panelSecurityHeaders({ variant: 'strict' })['Content-Security-Policy'], 'media-src')).toBe("media-src 'self' blob:");
    const csp = panelSecurityHeaders({ variant: 'strict', https: true, mediaOrigin: BUCKET })['Content-Security-Policy'];
    expect(directive(csp, 'media-src')).toBe(`media-src 'self' blob: ${BUCKET}`);
    // nothing else is widened by it: the frame, the object and the script stay closed
    for (const closed of ['default-src', 'script-src', 'frame-src', 'object-src', 'worker-src'])
      expect(directive(csp, closed), closed).not.toContain(BUCKET);
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

const imgSrc = (csp: string | undefined) => (csp ?? '').split('; ').find((directive) => directive.startsWith('img-src'));

describe('EVM-068 AC6 CSP img-src pins the same one origin for the thumbnails and previews (SR-WEB-04, SR-WEB-01)', () => {
  it("EVM-068 AC6 without the origin img-src stays 'self', data: and blob:", () => {
    expect(imgSrc(panelSecurityHeaders({ variant: 'strict', https: true })['Content-Security-Policy'])).toBe("img-src 'self' data: blob:");
  });

  it('EVM-068 AC6 with the origin img-src gets exactly that origin - never a wildcard, never https: as a whole scheme', () => {
    const csp = panelSecurityHeaders({ variant: 'strict', https: true, mediaOrigin: BUCKET })['Content-Security-Policy'];
    expect(imgSrc(csp)).toBe(`img-src 'self' data: blob: ${BUCKET}`);
    // no bare `*` and no bare `https:` scheme source (a `https:` followed by the host of the origin is the origin itself)
    expect((imgSrc(csp) ?? '').split(' ')).not.toContain('*');
    expect((imgSrc(csp) ?? '').split(' ')).not.toContain('https:');
    // the other directives are untouched: the bucket is not a source of scripts, styles or frames (media-src admits it since EVM-046: see below)
    for (const name of ['script-src', 'style-src', 'frame-src', 'default-src']) {
      expect(
        (csp ?? '').split('; ').find((directive) => directive.startsWith(name)),
        name,
      ).not.toContain(BUCKET);
    }
  });
});
