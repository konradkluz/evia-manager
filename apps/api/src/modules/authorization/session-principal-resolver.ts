/**
 * The single plug-in point for sessions: resolves the principal of a request through the `identity` facade (the owner
 * of the `sessions` table). Called once per request by the platform middleware; only the cookie counts — the
 * Authorization header is ignored in M1 (no bearer tokens before the mobile channel, E9).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Authentication, SessionResolver } from '../../platform/http/principal.ts';
import { requestEventContext } from '../../platform/http/request-context.ts';
import { SessionService } from '../identity/index.ts';

@Injectable()
export class SessionPrincipalResolver implements SessionResolver {
  readonly #sessions: SessionService;

  constructor(@Inject(SessionService) sessions: SessionService) {
    this.#sessions = sessions;
  }

  resolve(request: Request): Promise<Authentication> {
    return this.#sessions.authenticate(request.headers.cookie, requestEventContext(request));
  }
}
