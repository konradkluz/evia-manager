/**
 * HTTP adapter (`src/api`, ADR-0004: the only door to the contract) of the four operations of the mobile sign-in (EVM-100; contract EVM-090: `mobileLogin`, `mobileLoginTotp`,
 * `refreshMobileSession`, `mobileLogout`). Tested against the contract schemas here and against the scenario server in E2E; the real
 * API is wired in EVM-107. Rules (security W5, W8, W9; SR-LOG-08, SR-MOB-10, SR-COMM-04):
 * - every answer is parsed with the schema of the contract (tokens with their length limits); anything else is `unavailable`;
 * - a failure carries a code and, for `429`, the wait — never a body, a `detail`, a message or a cause;
 * - only an `https` origin (plain HTTP only for the emulator host in the e2e variant, as the runtime configuration decides);
 * - every request has a timeout; tokens and the installation secret travel in the body or the Authorization header only.
 */
import { zMobileLoginChallenge, zMobileSession, zProblem } from '@evia/contracts/zod';
import { Challenge, IssuedSession, revealChallenge } from '../auth/opaque';
import type { AuthClient, AuthFailure, AuthOutcome } from '../auth/ports';
import { parseRetryAfter } from '../auth/retry-after';
import { proofFields, type InstallationProof } from '../storage/installation-proof';
import { clientHeaders, type ClientPlatform } from './health';

export interface DeviceDescription {
  readonly model: string;
  readonly osVersion: string;
  readonly securityPatch: string;
}

export interface HttpAuthClientOptions {
  /** Validated base address of the API (`readRuntimeConfig`). */
  readonly baseUrl: string;
  /** `true` only in the e2e variant (the runtime configuration accepted a local HTTP host). */
  readonly allowLocalHttp: boolean;
  readonly platform: ClientPlatform;
  readonly appVersion: string;
  /** Description of the phone (contract `MobileDeviceInfo`, already normalised). */
  readonly device: () => Promise<DeviceDescription>;
  /** Proof of this installation for step 1 (`LocalDataHost.installationProof`); `null` = a new device. */
  readonly installationProof: () => Promise<InstallationProof | null>;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** For tests; the default is the global fetch of the platform. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

export const DEFAULT_AUTH_TIMEOUT_MS = 15_000;
const PATH = '/api/v1/auth/mobile';
const UNAVAILABLE: AuthFailure = { kind: 'unavailable' };

type Answer = { readonly status: number; readonly body: unknown; readonly retryAfter: string | null } | null;

export function createHttpAuthClient(options: HttpAuthClientOptions): AuthClient {
  const { baseUrl, allowLocalHttp, platform, appVersion, device, installationProof, timeoutMs = DEFAULT_AUTH_TIMEOUT_MS } = options;
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetch ?? ((request: Request) => fetch(request));
  const secureOrigin = baseUrl.startsWith('https://') || (allowLocalHttp && baseUrl.startsWith('http://'));

  async function post(path: string, body: unknown, bearer?: string): Promise<Answer> {
    if (!secureOrigin) return null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    const headers: Record<string, string> = { ...clientHeaders(platform, appVersion), Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
    const exchange = async (): Promise<Answer> => {
      const response = await fetchImpl(
        new Request(`${baseUrl}${PATH}${path}`, {
          method: 'POST',
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        }),
      );
      const retryAfter = response.headers.get('Retry-After');
      if (response.status >= 500 || response.status === 204) return { status: response.status, body: null, retryAfter };
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed, retryAfter };
    };
    try {
      return await Promise.race([exchange(), deadline]);
    } catch {
      // the error of fetch may carry the address or the body: it is dropped here (SR-LOG-08)
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function failure(answer: Answer): AuthFailure {
    if (answer === null || answer.status >= 500 || answer.status < 400) return UNAVAILABLE;
    const problem = zProblem.safeParse(answer.body);
    const code = problem.success ? problem.data.code : 'unknown';
    return answer.status === 429
      ? { kind: 'problem', status: 429, code, retryAfterMs: parseRetryAfter(answer.retryAfter, now()) }
      : { kind: 'problem', status: answer.status, code };
  }

  function session(answer: Answer): AuthOutcome<IssuedSession> {
    if (answer === null || answer.status !== 200) return failure(answer);
    const parsed = zMobileSession.safeParse(answer.body);
    if (!parsed.success) return UNAVAILABLE;
    const data = parsed.data;
    const serverTime = Date.parse(data.serverTime);
    const ttl = Date.parse(data.accessTokenExpiresAt) - serverTime;
    if (!Number.isFinite(serverTime) || !Number.isFinite(ttl)) return UNAVAILABLE;
    return {
      kind: 'ok',
      value: IssuedSession.of({
        deviceId: data.deviceId,
        installationSecret: data.installationSecret,
        accessToken: data.accessToken,
        accessTokenTtlMs: Math.max(0, ttl),
        refreshToken: data.refreshToken,
        serverTime,
        user: { id: data.user.id, displayName: data.user.displayName, role: data.user.role },
      }),
    };
  }

  return {
    async login({ email, password }) {
      const proof = await installationProof().catch(() => null);
      const pair = proof === null ? null : proofFields(proof);
      const answer = await post('/login', { email, password, device: await device(), ...(pair ?? {}) });
      if (answer === null || answer.status !== 200) return failure(answer);
      const parsed = zMobileLoginChallenge.safeParse(answer.body);
      if (!parsed.success) return UNAVAILABLE;
      const serverExpiry = Date.parse(parsed.data.challengeExpiresAt);
      // the deadline is kept in the frame of the phone: never later than the server says, at most 10 minutes from now
      const expiresAt = Number.isFinite(serverExpiry) ? Math.min(now() + 600_000, Math.max(now(), serverExpiry)) : now();
      return { kind: 'ok', value: Challenge.of(parsed.data.challengeToken, expiresAt) };
    },
    async loginTotp(challenge, code) {
      const token = revealChallenge(challenge);
      if (token === null) return UNAVAILABLE;
      return session(await post('/login/totp', { challengeToken: token, code }));
    },
    async refresh(refreshToken) {
      return session(await post('/token', { refreshToken }));
    },
    async logout(accessToken) {
      const answer = await post('/logout', undefined, accessToken);
      return answer !== null && answer.status === 204 ? { kind: 'ok', value: null } : failure(answer);
    },
  };
}
