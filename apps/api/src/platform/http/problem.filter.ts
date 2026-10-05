/**
 * The single error boundary of the API (SR-API-01, SR-ERR-01; ASVS V16.5.1, V13.4.2): every exception — from handlers,
 * guards, the router (unknown route) and the body parser — becomes application/problem+json without details. Unknown
 * errors are logged with the trace identifier and answered with 500 internal_error.
 *
 * Unknown routes: Nest runs guards only for existing routes, so the router's 404 is mapped here — without a principal
 * the answer is 401 unauthenticated (the route map is not disclosed; deny-by-default for E1), with one 404 not_found.
 * Handlers report missing objects with ProblemException('not_found'), never with Nest's NotFoundException.
 */
import {
  BadRequestException,
  Catch,
  HttpException,
  Inject,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from '../logging/logger.ts';
import { LOGGER } from '../tokens.ts';
import { PRINCIPAL_RESOLVER, type PrincipalResolver } from './principal.ts';
import { ProblemException, sendProblem, type ProblemCode } from './problem.ts';
import { traceIdOf } from './request-context.ts';

/** Errors created by the body parser (http-errors): status and a client-safe flag. */
interface HttpError {
  readonly status: number;
  readonly expose: boolean;
}

/** Errors of the body parser (http-errors) that are safe to classify as client errors: `expose` is set for 4xx only. */
const isHttpError = (error: unknown): error is HttpError =>
  error instanceof Error && typeof (error as { status?: unknown }).status === 'number' && (error as { expose?: unknown }).expose === true;

const BY_STATUS: Readonly<Record<number, ProblemCode>> = {
  400: 'malformed_json',
  401: 'unauthenticated',
  403: 'forbidden',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  readonly #logger: Logger;
  readonly #principals: PrincipalResolver;

  constructor(@Inject(LOGGER) logger: Logger, @Inject(PRINCIPAL_RESOLVER) principals: PrincipalResolver) {
    this.#logger = logger;
    this.#principals = principals;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const code = this.#codeOf(exception, request);
    if (code === 'internal_error') this.#logger.error({ err: exception, traceId: traceIdOf(response) }, 'unhandled error');
    if (response.headersSent) return;
    sendProblem(response, code, traceIdOf(response));
  }

  #codeOf(exception: unknown, request: Request): ProblemCode {
    if (exception instanceof ProblemException) return exception.code;
    if (exception instanceof NotFoundException) return this.#hasPrincipal(request) ? 'not_found' : 'unauthenticated';
    if (exception instanceof BadRequestException) return 'malformed_json';
    if (exception instanceof HttpException) return BY_STATUS[exception.getStatus()] ?? 'internal_error';
    // Client errors of the body parser (aborted request, invalid length …) are not server faults.
    if (isHttpError(exception)) return BY_STATUS[exception.status] ?? 'malformed_json';
    return 'internal_error';
  }

  /** Fail closed: a failing principal lookup counts as "no principal" (401, never a route map). */
  #hasPrincipal(request: Request): boolean {
    try {
      return this.#principals.resolve(request) !== null;
    } catch {
      return false;
    }
  }
}
