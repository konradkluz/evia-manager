// Fake of the mobile sign-in API that reproduces the ORDER of errors of EVM-094 AC3 (decision of Konrad 2026-10-28):
// 426 version → 429 limit → (pair of a device to wipe → 401 device_wipe_required) → 401 invalid_credentials (password) →
// 403 totp_not_configured / mfa_enrollment_required → [step 2] 401 invalid_credentials (code or challenge) → 403 channel_not_allowed
// → 403 device_limit_reached. Synthetic accounts only.
import { Challenge, revealChallenge } from '../../src/auth/opaque';
import type { AuthOutcome, SignInClient } from '../../src/auth/ports';
import { proofFields, type InstallationProof } from '../../src/storage/installation-proof';
import { issued } from './fakes';
import { DEVICE_1, T0, USER_A, challengeToken } from './fixtures';

export interface FakeAccount {
  email: string;
  password: string;
  code: string;
  role: 'administrator' | 'editor' | 'read_only';
  secondStep: 'totp' | 'passkey_only' | 'none';
  devicesFull?: boolean;
}

export interface FakeServerState {
  versionUnsupported: boolean;
  rateLimitedForSec: number | null;
  wipeDeviceId: string | null;
  wipeBetweenSteps: boolean;
  accounts: FakeAccount[];
}

const problem = (status: number, code: string, retryAfterMs?: number): AuthOutcome<never> =>
  retryAfterMs === undefined ? { kind: 'problem', status, code } : { kind: 'problem', status, code, retryAfterMs };

export class FakeAuthServer implements SignInClient {
  readonly state: FakeServerState = {
    versionUnsupported: false,
    rateLimitedForSec: null,
    wipeDeviceId: null,
    wipeBetweenSteps: false,
    accounts: [{ email: 'jan@example.test', password: 'synthetic-password', code: '123456', role: 'editor', secondStep: 'totp' }],
  };
  readonly requests: { step: 1 | 2; body: Record<string, unknown> }[] = [];
  network = true;
  #challenges = new Map<string, FakeAccount>();
  #n = 0;

  readonly #proof: () => Promise<InstallationProof | null>;
  constructor(proof: () => Promise<InstallationProof | null> = () => Promise.resolve(null)) {
    this.#proof = proof;
  }

  async login(credentials: { email: string; password: string }): Promise<AuthOutcome<Challenge>> {
    const proof = await this.#proof();
    const pair = proof === null ? null : proofFields(proof);
    this.requests.push({ step: 1, body: { ...credentials, ...(pair ?? {}) } });
    if (!this.network) return { kind: 'unavailable' };
    if (this.state.versionUnsupported) return problem(426, 'client_version_unsupported');
    if (this.state.rateLimitedForSec !== null) return problem(429, 'too_many_requests', this.state.rateLimitedForSec * 1000);
    if (pair !== null && pair.deviceId === this.state.wipeDeviceId) return problem(401, 'device_wipe_required');
    const account = this.state.accounts.find((a) => a.email === credentials.email && a.password === credentials.password);
    if (account === undefined) return problem(401, 'invalid_credentials');
    if (account.secondStep === 'passkey_only') return problem(403, 'totp_not_configured');
    if (account.secondStep === 'none') return problem(403, 'mfa_enrollment_required');
    this.#n += 1;
    const value = challengeToken(this.#n);
    this.#challenges.set(value, account);
    return { kind: 'ok', value: Challenge.of(value, T0 + 300_000) };
  }

  loginTotp(challenge: Challenge, code: string) {
    const value = revealChallenge(challenge) ?? '';
    this.requests.push({ step: 2, body: { challengeToken: value, code } });
    if (!this.network) return Promise.resolve<AuthOutcome<never>>({ kind: 'unavailable' });
    if (this.state.versionUnsupported) return Promise.resolve(problem(426, 'client_version_unsupported'));
    if (this.state.rateLimitedForSec !== null)
      return Promise.resolve(problem(429, 'too_many_requests', this.state.rateLimitedForSec * 1000));
    const account = this.#challenges.get(value);
    if (account === undefined || account.code !== code || account.secondStep !== 'totp') {
      return Promise.resolve(problem(401, 'invalid_credentials'));
    }
    this.#challenges.delete(value);
    if (account.role === 'read_only') return Promise.resolve(problem(403, 'channel_not_allowed'));
    if (account.devicesFull === true) return Promise.resolve(problem(403, 'device_limit_reached'));
    if (this.state.wipeBetweenSteps) return Promise.resolve(problem(401, 'device_wipe_required'));
    return Promise.resolve<AuthOutcome<ReturnType<typeof issued>>>({ kind: 'ok', value: issued({ user: USER_A, deviceId: DEVICE_1 }) });
  }
}
