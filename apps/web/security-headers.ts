/**
 * Security headers of the panel — the single source (EVM-008 AC4; decision (4) of Konrad; policies.md § P11;
 * SR-WEB-01, SR-WEB-08). Applied by `vite preview` (and the dev server) through securityHeadersPlugin(); from EVM-076
 * Caddy serves the same values (generated from or tested against this file).
 *
 * Variants:
 * - `strict` — preview and production: the CSP of P11 without the bucket and Sentry hosts (they do not exist yet), so
 *   img-src/media-src/connect-src are 'self' (+ data:/blob: as in P11). No 'unsafe-inline' or 'unsafe-eval'.
 * - `dev` — `vite dev` only: the same headers WITHOUT Content-Security-Policy, because the React Refresh preamble is an
 *   inline script and HMR uses ws:. Never used for anything served to users (residual risk RR-c).
 * - EVM-044: `mediaOrigin` — the ONE https origin of the media bucket (`MEDIA_BUCKET_ORIGIN`, the same value as in the API) is added to
 *   `connect-src`, because the browser sends the parts of a photo straight to the bucket with a signed `PUT`. Exactly one origin, no
 *   path, no wildcard (a wildcard such as `*.scw.cloud` would give a script an exfiltration channel to any bucket); no value means
 *   `'self'` only. A wrong value is a configuration error and stops the start (`parseMediaOrigin`).
 * `https: true` (EVM-076, behind TLS) adds upgrade-insecure-requests and HSTS; on http://localhost they would break
 * the browsers in E2E (Firefox upgrades the requests), so they stay off until then.
 */
import type { Plugin } from 'vite';

export type HeaderVariant = 'strict' | 'dev';

export interface PanelHeaderOptions {
  readonly variant: HeaderVariant;
  readonly https?: boolean;
  /** The origin of the media bucket (already validated by {@link parseMediaOrigin}); `undefined` = `connect-src 'self'` only. */
  readonly mediaOrigin?: string;
}

/**
 * The origin of the media bucket from the configuration: `undefined` for no value, otherwise exactly one `https://host[:port]`
 * (no path, query, credentials or wildcard). Anything else throws — the CSP must never silently widen.
 */
export function parseMediaOrigin(value: string | undefined): string | undefined {
  const text = value?.trim() ?? '';
  if (text === '') return undefined;
  let origin: string;
  try {
    const url = new URL(text);
    origin = url.protocol === 'https:' && !text.includes('*') && url.username === '' && url.password === '' ? url.origin : '';
  } catch {
    origin = '';
  }
  if (origin === '' || origin !== text)
    throw new Error('MEDIA_BUCKET_ORIGIN must be exactly one https origin without a path or a wildcard');
  return origin;
}

const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
];

/** HSTS of P11: one year with subdomains, no preload at the start. */
const HSTS = 'max-age=31536000; includeSubDomains';

export function panelSecurityHeaders({ variant, https = false, mediaOrigin }: PanelHeaderOptions): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (variant === 'strict') {
    const directives = CSP_DIRECTIVES.map((directive) =>
      directive === "connect-src 'self'" && mediaOrigin !== undefined ? `connect-src 'self' ${mediaOrigin}` : directive,
    );
    headers['Content-Security-Policy'] = (https ? [...directives, 'upgrade-insecure-requests'] : directives).join('; ');
  }
  if (https) headers['Strict-Transport-Security'] = HSTS;
  return headers;
}

interface HeaderTarget {
  setHeader(name: string, value: string): unknown;
}

/** Connect middleware that sets the headers on every response (documents, assets, proxied /api, errors). */
export function headerMiddleware(headers: Readonly<Record<string, string>>) {
  return (_request: unknown, response: HeaderTarget, next: () => void): void => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    next();
  };
}

/** Vite plugin: the strict variant for `vite preview`, the dev variant for `vite dev`. */
export function securityHeadersPlugin(): Plugin {
  return {
    name: 'evia-security-headers',
    configureServer(server) {
      server.middlewares.use(headerMiddleware(panelSecurityHeaders({ variant: 'dev' })));
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        headerMiddleware(panelSecurityHeaders({ variant: 'strict', mediaOrigin: parseMediaOrigin(process.env['MEDIA_BUCKET_ORIGIN']) })),
      );
    },
  };
}
