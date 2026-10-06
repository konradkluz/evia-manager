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

export type SessionState = 'mfa_enrollment' | 'active';

export interface Principal {
  readonly userId: string;
  readonly role: UserRole;
  readonly channel: Channel;
  readonly sessionId: string;
  readonly state: SessionState;
  /** The CSRF token this session expects (derived from the session token, never stored). */
  readonly csrfToken: string;
}

/** `revoked`: the credential was recognised but is no longer valid (401 session_revoked, not unauthenticated). */
export type Authentication = { readonly principal: Principal } | { readonly principal: null; readonly reason: 'anonymous' | 'revoked' };

export interface SessionResolver {
  resolve(request: Request): Promise<Authentication>;
}

export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');

export const ANONYMOUS: Authentication = { principal: null, reason: 'anonymous' };

const resolved = new WeakMap<Request, Authentication>();

/** @returns the authentication of the request; a request that never went through the middleware is anonymous */
export const authenticationOf = (request: Request): Authentication => resolved.get(request) ?? ANONYMOUS;

export const principalOf = (request: Request): Principal | null => authenticationOf(request).principal;

export function resolveAuthentication(resolver: SessionResolver, logger: Logger): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    resolver.resolve(request).then(
      (authentication) => {
        resolved.set(request, authentication);
        next();
      },
      (error: unknown) => {
        logger.warn({ err: error }, 'session lookup failed; the request continues without a principal');
        resolved.set(request, ANONYMOUS);
        next();
      },
    );
  };
}
