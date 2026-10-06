/**
 * The single plug-in point for sessions (E1): resolves the principal of a request from its session. M0 has no
 * sessions, so there is never a principal — any Authorization header or cookie is ignored (no bypass).
 */
import { Injectable } from '@nestjs/common';
import type { Principal, PrincipalResolver } from '../../platform/http/principal.ts';

@Injectable()
export class SessionPrincipalResolver implements PrincipalResolver {
  resolve(): Principal | null {
    return null;
  }
}
