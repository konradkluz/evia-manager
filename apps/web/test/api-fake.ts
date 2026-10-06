import type { CurrentSession } from '@evia/contracts';
import { vi } from 'vitest';

/** One request the panel sent, as a user-agnostic record for assertions (synthetic data only). */
export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

export type Handler = (request: Recorded) => Response | Promise<Response>;

export const ACTIVE_SESSION: CurrentSession = {
  user: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Anna Testowa', role: 'administrator' },
  state: 'active',
  channel: 'web',
  csrfToken: 'csrf-active',
  // EVM-067: the deadlines of the session (60 minutes idle, 12 hours absolute) — the panel reads them for the warning P-11
  idleExpiresAt: '2026-10-05T09:00:00.000Z',
  absoluteExpiresAt: '2026-10-05T20:00:00.000Z',
};

export const ENROLLMENT_SESSION: CurrentSession = { ...ACTIVE_SESSION, state: 'mfa_enrollment', csrfToken: 'csrf-enrollment' };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json; charset=utf-8' : 'application/json; charset=utf-8', ...headers },
  });
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json(
    status,
    { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra },
    headers,
  );
}

/**
 * A fake API behind `fetch`: routes keyed by "METHOD /path". An unregistered route fails the test loudly (a request the
 * panel must not send) instead of silently answering.
 */
export function createFakeApi(routes: Record<string, Handler>) {
  const requests: Recorded[] = [];
  const handlers = { ...routes };
  const fetchFake = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    const recorded: Recorded = {
      method: request.method,
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: await request.clone().text(),
    };
    requests.push(recorded);
    const handler = handlers[`${recorded.method} ${recorded.path}`];
    if (handler === undefined) throw new Error(`unexpected request ${recorded.method} ${recorded.path}`);
    return handler(recorded);
  });
  return {
    fetch: fetchFake as unknown as typeof fetch,
    requests,
    /** Replaces or adds a route while a test runs (e.g. the session after logout). */
    set(route: string, handler: Handler) {
      handlers[route] = handler;
    },
    calls(route: string): Recorded[] {
      return requests.filter((entry) => `${entry.method} ${entry.path}` === route);
    },
  };
}

/** Body of a recorded request as JSON (typed `unknown`: assertions compare it structurally). */
export function parseBody(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export const SESSION_ROUTE = 'GET /api/v1/auth/session';
