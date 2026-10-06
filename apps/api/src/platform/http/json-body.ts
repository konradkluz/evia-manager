/**
 * Request bodies (EVM-008 AC4, EVM-016; SR-INPUT-06, ASVS V4.1.1, V13.2.6). Deny-by-default stays first: an anonymous
 * request is parsed only when it targets a public operation that takes a body (exact method and path from the
 * contract, small limit); every other anonymous request is answered 401 by the guard without touching its body, so a
 * malformed, oversized or oddly encoded body cannot turn the 401 into 400/413/415. A request with a session may send
 * up to 1 MB. A body that is not `application/json` is 415. Only methods that carry a body are parsed.
 */
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ProblemException } from './problem.ts';
import { principalOf } from './principal.ts';

export const ANONYMOUS_BODY_LIMIT = '8kb';
export const SESSION_BODY_LIMIT = '1mb';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface BodyPolicy {
  /** Anonymous requests to a public operation with a body: exact method and path of the contract. */
  isPublicBodyOperation(method: string, path: string): boolean;
}

const hasBody = (request: Request): boolean => {
  const length = request.headers['content-length'];
  return (length !== undefined && length !== '0') || request.headers['transfer-encoding'] !== undefined;
};

/** `application/json` with optional parameters (charset is checked by the parser). */
export const isJsonContentType = (contentType: string | undefined): boolean =>
  contentType !== undefined && /^application\/json\s*(;|$)/i.test(contentType);

export function jsonBody(policy: BodyPolicy): RequestHandler {
  const parsers = {
    [ANONYMOUS_BODY_LIMIT]: express.json({ limit: ANONYMOUS_BODY_LIMIT }),
    [SESSION_BODY_LIMIT]: express.json({ limit: SESSION_BODY_LIMIT }),
  };
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!BODY_METHODS.has(request.method) || !hasBody(request)) {
      next();
      return;
    }
    const limit =
      principalOf(request) !== null
        ? SESSION_BODY_LIMIT
        : policy.isPublicBodyOperation(request.method, request.path)
          ? ANONYMOUS_BODY_LIMIT
          : undefined;
    if (limit === undefined) {
      next();
      return;
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      next(new ProblemException('unsupported_media_type'));
      return;
    }
    parsers[limit](request, response, next);
  };
}

/** Methods the API serves; TRACE, CONNECT and anything exotic are rejected before routing (CWE-16). */
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export function allowedMethods(request: Request, _response: Response, next: NextFunction): void {
  next(ALLOWED_METHODS.has(request.method) ? undefined : new ProblemException('method_not_allowed'));
}
