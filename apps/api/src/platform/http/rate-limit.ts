/** Middleware of the per-IP limit that applies to every request (1200/min; api-guidelines.md → Limity). */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ProblemException } from './problem.ts';
import { RATE_LIMITS, type RateBucket, type RateLimiter } from './rate-limiter.ts';

/** Counts one request in `bucket`; a request over the limit becomes 429 with Retry-After. */
export function enforceRateLimit(limiter: RateLimiter, bucket: RateBucket, request: Request): void {
  const decision = limiter.consume(bucket, request.ip, RATE_LIMITS[bucket]);
  if (!decision.allowed) throw new ProblemException('rate_limited', { retryAfterSeconds: decision.retryAfterSeconds });
}

export function globalRateLimit(limiter: RateLimiter): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    try {
      enforceRateLimit(limiter, 'global', request);
      next();
    } catch (error) {
      next(error);
    }
  };
}
