/**
 * The single plug-in point for sessions: resolves the principal of a request through the `identity` facade (the owner
 * of the `sessions` table). Called once per request by the platform middleware. Two credentials, two channels (EVM-094;
 * SR-AUTHZ-12): the cookie of the panel (`resolve`, the web channel) and the Bearer token of the phone (`resolveBearer`, the
 * mobile channel). Each is resolved on its own and neither stands in for the other — the guard takes the one that belongs
 * to the channel of the operation.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Authentication, SessionResolver } from '../../platform/http/principal.ts';
import { requestEventContext } from '../../platform/http/request-context.ts';
import { MobileSessionService, SessionService } from '../identity/index.ts';

@Injectable()
export class SessionPrincipalResolver implements SessionResolver {
  readonly #sessions: SessionService;
  readonly #mobile: MobileSessionService;

  constructor(@Inject(SessionService) sessions: SessionService, @Inject(MobileSessionService) mobile: MobileSessionService) {
    this.#sessions = sessions;
    this.#mobile = mobile;
  }

  resolve(request: Request): Promise<Authentication> {
    return this.#sessions.authenticate(request.headers.cookie, requestEventContext(request));
  }

  resolveBearer(request: Request): Promise<Authentication> {
    return this.#mobile.authenticate(request.headers.authorization);
  }
}
