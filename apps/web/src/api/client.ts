/**
 * Data layer of the panel (EVM-008 AC2, EVM-016; ADR-0004, ADR-0006): the fetch client generated from the OpenAPI
 * contract (@evia/contracts) and TanStack Query helpers. The API is same-origin (/api) — the session cookie
 * (`__Host-evia_session`, httpOnly) travels with same-origin requests and is never readable by the panel; the browser
 * adds `Origin` and `Sec-Fetch-Site`; mutations of a session add `X-CSRF-Token` from the memory of the tab (SR-SESS-10).
 */
import { createClient, getHealth, type Client, type FieldError, type Problem } from '@evia/contracts';
import { queryOptions } from '@tanstack/react-query';
import { getCsrfToken } from '../session/csrf.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `fetch` resolved at call time (tests and the browser may replace `globalThis.fetch` after the client is created).
 * The generated client calls the implementation without a receiver, which the browser's `fetch` rejects.
 */
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function createApiClient(fetchImplementation: typeof fetch = defaultFetch): Client {
  const client = createClient({ baseUrl: globalThis.location.origin, fetch: fetchImplementation });
  client.interceptors.request.use((request) => {
    const token = getCsrfToken();
    if (token !== null && !SAFE_METHODS.has(request.method)) request.headers.set('X-CSRF-Token', token);
    return request;
  });
  return client;
}

/** Failure of an API call: the status (0 = no response), the stable `code` of the problem and the field errors. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string | undefined;
  readonly errors: readonly FieldError[];
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, problem: Partial<Problem> | undefined, retryAfterSeconds?: number) {
    super(`API ${String(status)} ${problem?.code ?? 'no_response'}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code ?? (status === 0 ? 'network_error' : 'unknown');
    this.traceId = problem?.traceId;
    this.errors = problem?.errors ?? [];
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface CallResult<T> {
  readonly data?: T | undefined;
  readonly error?: unknown;
  readonly response?: Response | undefined;
}

function isProblem(value: unknown): value is Partial<Problem> {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string';
}

/** Resolves with the data of a generated SDK call or throws an {@link ApiError} (the error body is a Problem, SR-ERR-02). */
export async function unwrap<T>(pending: PromiseLike<CallResult<T>>): Promise<T> {
  const { data, error, response } = await pending;
  if (response === undefined) throw new ApiError(0, undefined);
  // An OK status with an error means the body could not be read (a broken server answer), which is a failure too.
  if (!response.ok || error !== undefined) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    throw new ApiError(
      response.status,
      isProblem(error) ? error : undefined,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  return data as T;
}

export function healthQueryOptions(client: Client) {
  return queryOptions({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      const { data } = await getHealth({ client, signal, throwOnError: true });
      return data;
    },
  });
}
