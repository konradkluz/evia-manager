/**
 * The authenticated principal of a request (EVM-016 W2). `platform` owns the port and the per-request result; the
 * `authorization` module implements the resolver through the `identity` facade — dependencies point from modules to
 * platform, never back (ADR-0001).
 *
 * The session is resolved asynchronously exactly once per request, in a middleware before the router (also for
 * unknown routes). The result is kept per request and read synchronously by the guard and the error filter. Anything
 * that goes wrong resolves to "no principal" (fail closed).
 */
import type { Channel, UserRole } from '@evia/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from '../logging/logger.ts';
import { ProblemException } from './problem.ts';

export type SessionState = 'mfa_enrollment' | 'active';

export interface Principal {
  readonly userId: string;
  readonly role: UserRole;
  readonly channel: Channel;
  readonly sessionId: string;
  readonly state: SessionState;
  /** The CSRF token this session expects (derived from the session token, never stored). */
  readonly csrfToken: string;
  /** The last authentication with a passkey in this session; null when there was none (SR-SESS-08: a step-up is then required). */
  readonly passkeyAuthenticatedAt: Date | null;
  /** The last authentication with a TOTP code in this session (EVM-023); null when there was none. The window of step-up is the later of the two. */
  readonly totpAuthenticatedAt: Date | null;
  /** Session clock (EVM-067): the last recorded activity and the two deadlines — the guard and `getCurrentSession` read them. */
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  /** The device of a mobile session (EVM-094) — always from the session, never from the request; absent for the panel. */
  readonly deviceId?: string;
}

/**
 * `revoked`: the credential was recognised but is no longer valid (401 session_revoked, not unauthenticated);
 * `expired`: the session ran out of idle time or of its absolute lifetime (401 session_expired).
 * `touch` (EVM-067): records the activity of the session — the guard calls it once the request is allowed, except for
 * passive operations (reading the session must not keep it alive, SR-WEB-05).
 */
export type Authentication =
  | { readonly principal: Principal; readonly touch?: () => Promise<void> }
  | { readonly principal: null; readonly reason: 'anonymous' | 'revoked' | 'expired' | 'wipe_required' };

export interface SessionResolver {
  /** The session of the cookie of the panel (the web channel). */
  resolve(request: Request): Promise<Authentication>;
  /** The session of the `Authorization: Bearer` token (the mobile channel, EVM-094); a separate credential: an operation of one channel never sees the other's. */
  resolveBearer?(request: Request): Promise<Authentication>;
}

export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

export const ANONYMOUS: Authentication = { principal: null, reason: 'anonymous' };

const resolved = new WeakMap<Request, Authentication>();
const resolvedBearer = new WeakMap<Request, Authentication>();

/** @returns the authentication of the request; a request that never went through the middleware is anonymous */
export const authenticationOf = (request: Request): Authentication => resolved.get(request) ?? ANONYMOUS;

export const principalOf = (request: Request): Principal | null => authenticationOf(request).principal;

/** The session of the Bearer token of the request (the mobile channel); handlers of mobile operations read it, handlers of the panel never do. */
export const bearerAuthenticationOf = (request: Request): Authentication => resolvedBearer.get(request) ?? ANONYMOUS;
export const bearerPrincipalOf = (request: Request): Principal | null => bearerAuthenticationOf(request).principal;

/**
 * The principal of an operation open to BOTH channels (EVM-131; the guard has decided which credential counts, `authenticationFor`): the session of the panel when the cookie holds one
 * (only a `web` session is a credential of the panel), else the session of the Bearer token. A handler of such an operation reads THIS - never `principalOf` alone, which does not
 * see the token. Its `channel` and `deviceId` say where the caller came from; a handler never takes either from the request.
 */
export function dualChannelPrincipalOf(request: Request): Principal | null {
  const cookie = principalOf(request);
  return cookie !== null && cookie.channel === 'web' ? cookie : bearerPrincipalOf(request);
}

/**
 * The creator of an upload session (EVM-131; SR-SYNC-08, SR-API-05, CWE-639): the user and the device. The device is ONLY the one of the session of the phone (`principal.deviceId`, set by
 * the resolver from the Bearer token) - never a header or a field of the body; the panel has none (`null`, whatever a session of the panel carries). A session of the phone without a device
 * is not a case that exists: it fails closed (`403`) rather than becoming the creator of the panel.
 */
export function sessionCreatorOf(principal: Principal): { readonly userId: string; readonly deviceId: string | null } {
  if (principal.channel !== 'mobile') return { userId: principal.userId, deviceId: null };
  if (principal.deviceId === undefined) throw new ProblemException('forbidden');
  return { userId: principal.userId, deviceId: principal.deviceId };
}

export function resolveAuthentication(resolver: SessionResolver, logger: Logger): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    // Both credentials are resolved on their own and fail closed on their own; which one counts is decided by the channel of the operation (the guard).
    const settle = (lookup: Promise<Authentication>, store: WeakMap<Request, Authentication>): Promise<void> =>
      lookup.then(
        (authentication) => {
          store.set(request, authentication);
        },
        (error: unknown) => {
          logger.warn({ err: error }, 'session lookup failed; the request continues without a principal');
          store.set(request, ANONYMOUS);
        },
      );
    void Promise.all([
      settle(resolver.resolve(request), resolved),
      settle(resolver.resolveBearer?.(request) ?? Promise.resolve(ANONYMOUS), resolvedBearer),
    ]).then(() => {
      next();
    });
  };
}
