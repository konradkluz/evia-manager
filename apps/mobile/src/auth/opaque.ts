/**
 * Opaque carriers of the secrets of the sign-in (EVM-100 AC1, AC2; security W2, W5; MASVS-STORAGE-2): the challenge token of step 1
 * and the session of step 2. They pass through the sign-in machine and React without a readable field — every serialisation gives a
 * constant — so a token can never reach a log, the state of a screen, an error report or a snapshot. Only the HTTP adapter creates them
 * and only the session owner (and the adapter, for the challenge) unwraps them.
 */
/** Role of the user (domain glossary — Administrator, Edytor, Tylko odczyt); shown in the UI, never used to authorise. */
export type UserRole = 'administrator' | 'editor' | 'read_only';

export interface SessionData {
  readonly deviceId: string;
  /** New installation secret (every sign-in rotates it, two-phase); absent in a refresh. */
  readonly installationSecret: string | undefined;
  readonly accessToken: string;
  /** Lifetime of the access token in the frame of the server (`accessTokenExpiresAt - serverTime`). */
  readonly accessTokenTtlMs: number;
  readonly refreshToken: string;
  /** `serverTime` of the response (epoch ms). */
  readonly serverTime: number;
  readonly user: { readonly id: string; readonly displayName: string; readonly role: UserRole };
}

const REDACTED = '[redacted]';
const challenges = new WeakMap<Challenge, string>();
const sessions = new WeakMap<IssuedSession, SessionData>();

export class Challenge {
  /** Local deadline (epoch ms of the phone) after which the token is dropped without a request. */
  readonly expiresAt: number;

  private constructor(expiresAt: number) {
    this.expiresAt = expiresAt;
    Object.freeze(this);
  }

  static of(token: string, expiresAt: number): Challenge {
    const challenge = new Challenge(expiresAt);
    challenges.set(challenge, token);
    return challenge;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }
}

export function revealChallenge(challenge: Challenge): string | null {
  return challenges.get(challenge) ?? null;
}

export class IssuedSession {
  private constructor() {
    Object.freeze(this);
  }

  static of(data: SessionData): IssuedSession {
    const session = new IssuedSession();
    sessions.set(session, data);
    return session;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }
}

export function revealSession(session: IssuedSession): SessionData | null {
  return sessions.get(session) ?? null;
}
