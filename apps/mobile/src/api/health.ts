/**
 * Thin client of `GET /api/health` over the generated contract client (EVM-009 AC2, AC3; ADR-0004): it returns a state, never an
 * exception, and never the address or the content of an answer (SR-LOG-08, SR-MOB-10). The API adapters (this module and
 * `src/auth/http-auth-client.ts`) are the only importers of @evia/contracts; both send the compatibility headers of `clientHeaders`.
 */
import { createClient, getHealth } from '@evia/contracts';
import { zGetHealthResponse } from '@evia/contracts/zod';

export type ClientPlatform = 'android' | 'ios';

export type HealthResult =
  | { readonly kind: 'ok'; readonly minSupportedAppVersion: Readonly<Record<string, string>> }
  /** The request was rejected before any answer: no network, DNS failure, refused connection. */
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  /** The server answered with an error status (5xx, 404, a proxy page). */
  | { readonly kind: 'server' }
  /** The answer does not match the contract. */
  | { readonly kind: 'invalid' };

export interface HealthClientOptions {
  readonly baseUrl: string;
  readonly platform: ClientPlatform;
  /** The app version (`version` of app.config.ts), sent as X-Client-Version. */
  readonly appVersion: string;
  readonly timeoutMs?: number;
  /** For tests; the default is the global fetch of the platform. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

/** Compatibility headers of every request of the app (api-guidelines → "Minimalna wersja aplikacji"). */
export function clientHeaders(platform: ClientPlatform, appVersion: string): Record<'X-Client-Platform' | 'X-Client-Version', string> {
  return { 'X-Client-Platform': platform, 'X-Client-Version': appVersion };
}

export interface HealthClient {
  fetchHealth: () => Promise<HealthResult>;
}

/** The generated client always calls fetch with a ready Request; this adapts a Request-taking function to the fetch signature. */
function requestFetch(impl: (request: Request) => Promise<Response>) {
  return (input: string | Request | URL, init?: RequestInit): Promise<Response> =>
    impl(
      input instanceof Request && init === undefined
        ? input
        : new Request(typeof input === 'object' && !(input instanceof Request) ? input.toString() : input, init),
    );
}

export function createHealthClient({
  baseUrl,
  platform,
  appVersion,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  fetch,
}: HealthClientOptions): HealthClient {
  // The compatibility headers (api-guidelines → "Minimalna wersja aplikacji") are set here, once, for every request of this client.
  const client = createClient({
    baseUrl,
    headers: clientHeaders(platform, appVersion),
    ...(fetch === undefined ? {} : { fetch: requestFetch(fetch) }),
  });

  async function fetchHealth(): Promise<HealthResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The abort signal alone is not enough: a transport that ignores it would keep the check "loading" forever.
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve('timeout');
      }, timeoutMs);
    });
    try {
      const outcome = await Promise.race([getHealth({ client, signal: controller.signal }), deadline]);
      if (outcome === 'timeout' || controller.signal.aborted) return { kind: 'timeout' };
      if (outcome.response === undefined) return { kind: 'network' };
      if (!outcome.response.ok) return { kind: 'server' };
      const parsed = zGetHealthResponse.safeParse(outcome.data);
      return parsed.success ? { kind: 'ok', minSupportedAppVersion: parsed.data.minSupportedAppVersion } : { kind: 'invalid' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetchHealth };
}
