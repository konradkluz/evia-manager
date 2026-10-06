/**
 * Security headers of every API response, errors included (SR-API-03; ASVS V3.4, V14.2.2, V14.3.2). Registered as the
 * first middleware, before the body parser, so 400, 401, 404 and 500 responses carry them too. No CORS headers: the
 * panel is served from the same origin (ADR-0004).
 */
import type { NextFunction, Request, Response } from 'express';

export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
});

export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.set(API_SECURITY_HEADERS);
  next();
}
