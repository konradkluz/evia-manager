/**
 * Port for the authenticated principal of a request. Defined by `platform` (the error filter needs it to answer 401
 * instead of 404 for unknown routes) and implemented by the `authorization` module — dependencies point from modules
 * to platform, never back (ADR-0001). In M0 there is no session, so no principal (E1 plugs in sessions).
 */
import type { Request } from 'express';

export interface Principal {
  readonly userId: string;
}

export interface PrincipalResolver {
  resolve(request: Request): Principal | null;
}

export const PRINCIPAL_RESOLVER = Symbol('PRINCIPAL_RESOLVER');
