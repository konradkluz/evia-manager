/**
 * Request context (ADR-0013): a server-generated trace identifier per request, kept in AsyncLocalStorage for the logger
 * and in `res.locals` for error responses. An incoming `traceparent` is not trusted in M0 (log injection, SR-LOG-05).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { EventContext } from '../events/event-bus.ts';

export interface RequestContext {
  readonly traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** @returns 32 lower-case hex characters (W3C trace-id format) */
export const newTraceId = (): string => randomBytes(16).toString('hex');

export function requestContext(_request: Request, response: Response, next: NextFunction): void {
  const context: RequestContext = { traceId: newTraceId() };
  response.locals['traceId'] = context.traceId;
  storage.run(context, next);
}

export const currentTraceId = (): string | undefined => storage.getStore()?.traceId;

/** pino mixin: adds the trace identifier of the current request to every log entry. */
export function requestContextMixin(): Record<string, unknown> {
  const traceId = currentTraceId();
  return traceId === undefined ? {} : { traceId };
}

/** @returns the trace identifier of the response, or a fresh one when the request bypassed the context middleware */
export function traceIdOf(response: Response): string {
  const traceId: unknown = response.locals['traceId'];
  return typeof traceId === 'string' ? traceId : newTraceId();
}

/** Context of an event raised before a handler runs (the session lookup of the middleware): the trace identifier comes from the request scope. */
export const requestEventContext = (request: Request): EventContext => ({
  origin: 'web',
  traceId: currentTraceId() ?? newTraceId(),
  ip: request.ip,
});

/** The explicit context a use case receives from an HTTP request: origin, trace identifier, client address (memory only). */
export const webEventContext = (request: Request, response: Response): EventContext => ({
  origin: 'web',
  traceId: traceIdOf(response),
  ip: request.ip,
});
