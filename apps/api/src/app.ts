/**
 * HTTP pipeline of the API, shared by src/main.ts and the tests (EVM-008 AC4). Order matters: request context,
 * security headers (first, so every response has them), request log, JSON body parser only for requests with a principal
 * (default limit 100 kB; anonymous bodies are never parsed, so the guard answers 401), then Nest routing with the guard
 * and the problem filter.
 */
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { Logger } from './platform/logging/logger.ts';
import { authenticatedJsonBody } from './platform/http/json-body.ts';
import { PRINCIPAL_RESOLVER, type PrincipalResolver } from './platform/http/principal.ts';
import { requestContext } from './platform/http/request-context.ts';
import { requestLogging } from './platform/http/request-logging.ts';
import { securityHeaders } from './platform/http/security-headers.ts';

/**
 * The Express instance with router settings applied before Nest touches it (the router is created once): exact paths
 * only (`/api/health/` and `/API/health` are not the health endpoint), no X-Powered-By, and the production mode of
 * Express' fallback handler, which never renders stack traces.
 */
export function createHttpAdapter(): ExpressAdapter {
  const server = express();
  server.set('strict routing', true);
  server.set('case sensitive routing', true);
  server.set('env', 'production');
  server.disable('x-powered-by');
  return new ExpressAdapter(server);
}

export function configureApp(app: NestExpressApplication, logger: Logger): void {
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(requestLogging(logger));
  app.use(authenticatedJsonBody(app.get<PrincipalResolver>(PRINCIPAL_RESOLVER, { strict: false })));
}
