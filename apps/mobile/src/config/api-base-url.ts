/**
 * Validation of the API address (EVM-009 AC6; SR-COMM-04, MASVS-NETWORK-1): the app talks to the API over HTTPS only.
 * Plain HTTP is accepted solely for the local emulator host and only in the e2e build variant, which the CI never builds.
 * Pure code without imports: shared by app.config.ts (build time) and the runtime configuration.
 */

export type BuildVariant = 'release' | 'e2e';

/** Hosts reachable from an Android emulator that may use plain HTTP in the e2e variant (10.0.2.2 is the host machine). */
export const LOCAL_HTTP_HOSTS: readonly string[] = ['10.0.2.2', 'localhost', '127.0.0.1'];

export type ApiBaseUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'missing' | 'malformed' | 'scheme' | 'insecure-host' };

// scheme://host[:port][/path] — no userinfo (@), no query, no fragment, no whitespace.
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^\s/?#@]+)((?:\/[^\s?#]*)?)$/i;

/** Variant from the environment; anything but the exact value `e2e` is the strict `release` variant (fail closed). */
export function resolveBuildVariant(value: string | undefined): BuildVariant {
  return value === 'e2e' ? 'e2e' : 'release';
}

export function parseApiBaseUrl(raw: string | undefined, { allowLocalHttp }: { allowLocalHttp: boolean }): ApiBaseUrlResult {
  const value = raw?.trim() ?? '';
  if (value === '') return { ok: false, reason: 'missing' };
  const match = URL_PATTERN.exec(value);
  const scheme = match?.[1]?.toLowerCase();
  const authority = match?.[2];
  const path = match?.[3] ?? '';
  if (scheme === undefined || authority === undefined) return { ok: false, reason: 'malformed' };
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase();
  if (host === '' || host.includes(':')) return { ok: false, reason: 'malformed' };
  const normalized = `${scheme}://${authority.toLowerCase()}${path.replace(/\/+$/, '')}`;
  if (scheme === 'https') return { ok: true, url: normalized };
  if (scheme !== 'http') return { ok: false, reason: 'scheme' };
  return allowLocalHttp && LOCAL_HTTP_HOSTS.includes(host) ? { ok: true, url: normalized } : { ok: false, reason: 'insecure-host' };
}
