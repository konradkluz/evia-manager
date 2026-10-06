/**
 * Global guard (APP_GUARD): every request to an existing route passes decideAccess(); a denial throws a problem.
 * After an allow it checks the query string against the parameters declared in the contract (duplicate or unknown
 * parameter → 400) — late on purpose, so an anonymous client learns nothing about operations before authentication.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AppConfig } from '../../platform/config/config.ts';
import { OPERATION_ID } from '../../platform/http/operation-id.ts';
import { authenticationOf } from '../../platform/http/principal.ts';
import { ProblemException } from '../../platform/http/problem.ts';
import { assertQueryParameters, SAFE_METHODS } from '../../platform/http/query-parameters.ts';
import { RATE_LIMITER, RATE_LIMITS, type RateLimiter } from '../../platform/http/rate-limiter.ts';
import { APP_CONFIG } from '../../platform/tokens.ts';
import { channelAllowedForRole, csrfMatches } from '../identity/index.ts';
import { decideAccess } from './access-decision.ts';
import { POLICY_SOURCE, type PolicySource } from './policy-source.ts';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #policies: PolicySource;
  readonly #limiter: RateLimiter;
  readonly #panelOrigin: string;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(POLICY_SOURCE) policies: PolicySource,
    @Inject(RATE_LIMITER) limiter: RateLimiter,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#reflector = reflector;
    this.#policies = policies;
    this.#limiter = limiter;
    this.#panelOrigin = config.panelOrigin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const operationId = this.#reflector.get<string | undefined>(OPERATION_ID, context.getHandler());
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
      authentication: () => authenticationOf(request),
      csrfMatches: (principal) => csrfMatches(principal.csrfToken, request.get('x-csrf-token')),
      rateLimit: (bucket) => this.#limiter.consume(bucket, request.ip, RATE_LIMITS[bucket]),
      channelAllowed: channelAllowedForRole,
    });
    if (!decision.allowed) {
      throw new ProblemException(
        decision.code,
        decision.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: decision.retryAfterSeconds },
      );
    }
    assertQueryParameters(request.query, this.#policies.manifest[operationId ?? '']?.query ?? []);
    return true;
  }
}
