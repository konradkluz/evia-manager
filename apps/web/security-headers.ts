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
 * `https: true` (EVM-076, behind TLS) adds upgrade-insecure-requests and HSTS; on http://localhost they would break
 * the browsers in E2E (Firefox upgrades the requests), so they stay off until then.
 */
import type { Plugin } from 'vite';

export type HeaderVariant = 'strict' | 'dev';

export interface PanelHeaderOptions {
  readonly variant: HeaderVariant;
  readonly https?: boolean;
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

export function panelSecurityHeaders({ variant, https = false }: PanelHeaderOptions): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (variant === 'strict') {
    headers['Content-Security-Policy'] = (https ? [...CSP_DIRECTIVES, 'upgrade-insecure-requests'] : CSP_DIRECTIVES).join('; ');
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
      server.middlewares.use(headerMiddleware(panelSecurityHeaders({ variant: 'strict' })));
    },
  };
}
