/**
 * Global guard (APP_GUARD): every request to an existing route passes decideAccess(); a denial throws a problem.
 * After an allow it checks the query string against the parameters declared in the contract (duplicate or unknown
 * parameter → 400) — late on purpose, so an anonymous client learns nothing about operations before authentication.
 * Last, an allowed request of a session that is not a passive operation records the activity (EVM-067): the idle
 * deadline of the session moves on.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Clock } from '../../platform/clock/clock.ts';
import type { AppConfig } from '../../platform/config/config.ts';
import { OPERATION_ID } from '../../platform/http/operation-id.ts';
import { authenticationOf, bearerAuthenticationOf, type Authentication } from '../../platform/http/principal.ts';
import { ProblemException } from '../../platform/http/problem.ts';
import { assertQueryParameters, SAFE_METHODS } from '../../platform/http/query-parameters.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../platform/http/rate-limiter.ts';
import { APP_CONFIG, CLOCK } from '../../platform/tokens.ts';
import {
  atLeast,
  channelAllowedForRole,
  csrfMatches,
  lastStepUpAuthentication,
  readClientVersion,
  stepUpFresh,
} from '../identity/index.ts';
import { decideAccess } from './access-decision.ts';
import { POLICY_SOURCE, type PolicySource } from './policy-source.ts';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #policies: PolicySource;
  readonly #limiter: RateLimiter;
  readonly #panelOrigin: string;
  readonly #clock: Clock;
  readonly #minVersions: AppConfig['minSupportedAppVersion'];

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(POLICY_SOURCE) policies: PolicySource,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.#reflector = reflector;
    this.#policies = policies;
    this.#limiter = limiter;
    this.#panelOrigin = config.panelOrigin;
    this.#clock = clock;
    this.#minVersions = config.minSupportedAppVersion;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const operationId = this.#reflector.get<string | undefined>(OPERATION_ID, context.getHandler());
    const operation =
      operationId === undefined || !Object.hasOwn(this.#policies.manifest, operationId) ? undefined : this.#policies.manifest[operationId];
    const declaredQuery = operation?.query ?? [];
    const channels = operation?.authz.channels ?? ['web'];
    const versionChecked = operationId !== undefined && this.#policies.clientVersionOperations.includes(operationId);
    const isPublic = operation?.authz.public === true;
    // The sign-in of the phone is refused for an old app BEFORE the limits and the hashing of the password (EVM-094 AC6); the operations with a token — once allowed.
    if (versionChecked && isPublic) this.#assertClientVersion(request);
    const source = authenticationFor(request, channels);
    const decision = decideAccess({
      operationId,
      manifest: this.#policies.manifest,
      publicOperations: this.#policies.publicOperations,
      mfaEnrollmentOperations: this.#policies.mfaEnrollmentOperations,
      authenticationOperations: this.#policies.authenticationOperations,
      mutating: !SAFE_METHODS.has(request.method),
      origin: request.get('origin'),
      secFetchSite: request.get('sec-fetch-site'),
      panelOrigin: this.#panelOrigin,
      authentication: () => source.authentication,
      viaBearer: source.bearer,
      csrfMatches: (principal) => csrfMatches(principal.csrfToken, request.get('x-csrf-token')),
      rateLimit: (bucket) => this.#limiter.consume(bucket, request.ip, RATE_LIMITS[bucket]),
      rateLimitUser: (principal) => this.#limiter.consumeSubject('user', principal.userId, RATE_LIMITS.user),
      channelAllowed: channelAllowedForRole,
      stepUpFresh: (principal) => stepUpFresh(lastStepUpAuthentication(principal), this.#clock.now()),
    });
    if (!decision.allowed) {
      throw new ProblemException(
        decision.code,
        decision.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: decision.retryAfterSeconds },
      );
    }
    if (versionChecked && !isPublic) this.#assertClientVersion(request);
    assertQueryParameters(request.query, declaredQuery);
    const { authentication } = source;
    if (authentication.principal !== null && this.#recordsActivity(operationId)) await authentication.touch?.();
    return true;
  }

  /**
   * `426` for a phone older than the minimum, or one that does not say which it is (SR-API-08): the headers serve compatibility only — they never decide who
   * the caller is, which channel an operation belongs to or which check is skipped. The session is not touched.
   */
  #assertClientVersion(request: Request): void {
    const client = readClientVersion(request.get('x-client-platform'), request.get('x-client-version'));
    if (client === undefined || !atLeast(client.version, this.#minVersions[client.platform])) {
      throw new ProblemException('client_version_unsupported', { minSupportedVersion: this.#minVersions });
    }
  }

  /** Public operations (a sign-in with an old cookie) and passive ones do not count as activity of the session. */
  #recordsActivity(operationId: string | undefined): boolean {
    const { publicOperations, passiveOperations } = this.#policies;
    return ![...publicOperations, ...passiveOperations].some((id) => id === operationId);
  }
}

/**
 * The credential that counts for an operation is the one of ITS channel (SR-AUTHZ-12; EVM-094): the cookie for the panel, the Bearer token for the phone. A
 * credential of the other channel is ignored — it neither authenticates nor changes the answer (a web cookie on a mobile operation is 401, a token on an
 * operation of the panel is 401). An operation open to both channels takes the cookie first.
 */
function authenticationFor(
  request: Request,
  channels: readonly string[],
): { readonly authentication: Authentication; readonly bearer: boolean } {
  const web = channels.includes('web');
  const mobile = channels.includes('mobile');
  if (mobile && !web) return { authentication: bearerAuthenticationOf(request), bearer: true };
  if (!mobile) return { authentication: authenticationOf(request), bearer: false };
  const cookie = authenticationOf(request);
  return cookie.principal !== null
    ? { authentication: cookie, bearer: false }
    : { authentication: bearerAuthenticationOf(request), bearer: true };
}
