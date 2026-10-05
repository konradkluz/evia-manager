/**
 * One log entry per request (ADR-0013, SR-LOG-02): method, route template (never the raw URL with its query string),
 * status, duration and trace identifier. No bodies, no headers, no IP address.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../logging/logger.ts';
import { traceIdOf } from './request-context.ts';

export const UNMATCHED_ROUTE = '(unmatched)';

/** @returns the matched route template, e.g. /api/v1/work-orders/:workOrderId */
export function routeTemplate(request: Request): string {
  const path: unknown = (request.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${request.baseUrl}${path}` : UNMATCHED_ROUTE;
}

export function requestLogging(logger: Logger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const started = performance.now();
    response.on('finish', () => {
      logger.info(
        {
          traceId: traceIdOf(response),
          method: request.method,
          route: routeTemplate(request),
          status: response.statusCode,
          durationMs: Math.round((performance.now() - started) * 10) / 10,
        },
        'request completed',
      );
    });
    next();
  };
}
