/**
 * JSON body parser behind authentication (EVM-008 AC4; deny-by-default, SR-AUTHZ-01). The body of a request is parsed
 * only when the request has a principal — anonymous clients never reach the parser, so a malformed, oversized or badly
 * encoded body cannot turn the 401 of the guard into 400/413/415. Limits are body-parser defaults (100 kB, UTF-8).
 * M0 has no public operation with a body; E1 (sign-in) must decide here how public operations get their body.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import type { PrincipalResolver } from './principal.ts';

/** Fail closed: a failing principal lookup counts as "no principal" (no parsing; the guard answers 401). */
function hasPrincipal(principals: PrincipalResolver, request: Request): boolean {
  try {
    return principals.resolve(request) !== null;
  } catch {
    return false;
  }
}

export function authenticatedJsonBody(principals: PrincipalResolver): RequestHandler {
  const parse = express.json();
  return (request: Request, response: Response, next: NextFunction): void => {
    if (hasPrincipal(principals, request)) {
      parse(request, response, next);
      return;
    }
    next();
  };
}
