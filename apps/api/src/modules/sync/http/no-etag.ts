/**
 * Middleware of the snapshot of an order (EVM-097 AC3; SR-SYNC-04): the answer carries no `ETag`. Express derives a weak validator from the body of every answer,
 * and a validator over the aggregate of an order (or over a problem) has no use on a response that is `no-store` - the phone never revalidates it - so it is taken
 * off before the headers go out. Applies to every answer of the route: the data, the `404` that must look the same for every cause, the `400`, the `401`, the `429`.
 */
import type { NextFunction, Request, Response } from 'express';

export function withoutEtag(_request: Request, response: Response, next: NextFunction): void {
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => Response;
  response.writeHead = ((...args: unknown[]) => {
    response.removeHeader('ETag');
    return writeHead(...args);
  }) as typeof response.writeHead;
  next();
}
