/** Global guard (APP_GUARD): every request to an existing route passes decideAccess(); a denial throws a problem. */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { OPERATION_ID } from '../../platform/http/operation-id.ts';
import { PRINCIPAL_RESOLVER, type PrincipalResolver } from '../../platform/http/principal.ts';
import { ProblemException } from '../../platform/http/problem.ts';
import { decideAccess } from './access-decision.ts';
import { POLICY_SOURCE, type PolicySource } from './policy-source.ts';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #principals: PrincipalResolver;
  readonly #policies: PolicySource;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(PRINCIPAL_RESOLVER) principals: PrincipalResolver,
    @Inject(POLICY_SOURCE) policies: PolicySource,
  ) {
    this.#reflector = reflector;
    this.#principals = principals;
    this.#policies = policies;
  }

  canActivate(context: ExecutionContext): boolean {
    const decision = decideAccess({
      operationId: this.#reflector.get<string | undefined>(OPERATION_ID, context.getHandler()),
      manifest: this.#policies.manifest,
      publicOperations: this.#policies.publicOperations,
      principal: () => this.#principals.resolve(context.switchToHttp().getRequest<Request>()),
    });
    if (!decision.allowed) throw new ProblemException(decision.code);
    return true;
  }
}
