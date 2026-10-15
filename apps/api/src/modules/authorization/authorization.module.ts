/**
 * Module `authorization` (ADR-0001): the global deny-by-default guard, the principal resolver (sessions — E1) and the
 * startup check of route policies; the predicate of the right to read payments (EVM-056, W4) for `overview` and `payments`. Depends on `platform` and on the contract manifest, never the other way round.
 */
import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { SESSION_RESOLVER } from '../../platform/http/principal.ts';
import { IdentityModule } from '../identity/index.ts';
import { AuthorizationGuard } from './authorization.guard.ts';
import { PAYMENT_READ_POLICY, canReadPayments } from './payment-read-policy.ts';
import { CONTRACT_POLICIES, POLICY_SOURCE } from './policy-source.ts';
import { RoutePolicyCheck } from './route-policies.ts';
import { SessionPrincipalResolver } from './session-principal-resolver.ts';

@Global()
@Module({
  imports: [DiscoveryModule, IdentityModule],
  providers: [
    { provide: POLICY_SOURCE, useValue: CONTRACT_POLICIES },
    { provide: SESSION_RESOLVER, useClass: SessionPrincipalResolver },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: PAYMENT_READ_POLICY, useValue: canReadPayments },
    RoutePolicyCheck,
  ],
  exports: [SESSION_RESOLVER, POLICY_SOURCE, PAYMENT_READ_POLICY],
})
export class AuthorizationModule {}
