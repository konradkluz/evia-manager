/**
 * Module `authorization` (ADR-0001): the global deny-by-default guard, the principal resolver (sessions — E1) and the
 * startup check of route policies. Depends on `platform` and on the contract manifest, never the other way round.
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { PRINCIPAL_RESOLVER } from '../../platform/http/principal.ts';
import { AuthorizationGuard } from './authorization.guard.ts';
import { CONTRACT_POLICIES, POLICY_SOURCE } from './policy-source.ts';
import { RoutePolicyCheck } from './route-policies.ts';
import { SessionPrincipalResolver } from './session-principal-resolver.ts';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    { provide: POLICY_SOURCE, useValue: CONTRACT_POLICIES },
    { provide: PRINCIPAL_RESOLVER, useClass: SessionPrincipalResolver },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    RoutePolicyCheck,
  ],
  exports: [PRINCIPAL_RESOLVER],
})
export class AuthorizationModule {}
