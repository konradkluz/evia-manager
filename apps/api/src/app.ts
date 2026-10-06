/**
 * HTTP pipeline of the API, shared by src/main.ts and the tests (EVM-008 AC4, EVM-016). Order matters: request context,
 * security headers (first, so every response has them), request log, method check, per-IP limit of all requests, the
 * session resolved once per request (fail closed), the JSON body parser (anonymous bodies only for public operations
 * with a body; the guard answers 401 for the rest), then Nest routing with the guard and the problem filter.
 */
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { POLICY_SOURCE, type PolicySource } from './modules/authorization/index.ts';
import type { Logger } from './platform/logging/logger.ts';
import { allowedMethods, jsonBody } from './platform/http/json-body.ts';
import { resolveAuthentication, SESSION_RESOLVER, type SessionResolver } from './platform/http/principal.ts';
import { globalRateLimit } from './platform/http/rate-limit.ts';
import { RATE_LIMITER, type RateLimiter } from './platform/http/rate-limiter.ts';
import { requestContext } from './platform/http/request-context.ts';
import { requestLogging } from './platform/http/request-logging.ts';
import { securityHeaders } from './platform/http/security-headers.ts';

/**
 * The Express instance with router settings applied before Nest touches it (the router is created once): exact paths
 * only (`/api/health/` and `/API/health` are not the health endpoint), no X-Powered-By, and the production mode of
 * Express' fallback handler, which never renders stack traces.
 */
export function createHttpAdapter(trustedProxies: readonly string[] = []): ExpressAdapter {
  const server = express();
  // X-Forwarded-For is believed only from the listed proxies (default none): a client cannot choose its own address (CWE-348).
  server.set('trust proxy', trustedProxies.length > 0 ? [...trustedProxies] : false);
  server.set('strict routing', true);
  server.set('case sensitive routing', true);
  server.set('env', 'production');
  server.disable('x-powered-by');
  return new ExpressAdapter(server);
}

/** Anonymous requests with a body are parsed only for public operations that take one (exact method and path). */
function bodyPolicy({ manifest, publicOperations }: PolicySource) {
  const targets = new Set(
    publicOperations.flatMap((id) => (Object.hasOwn(manifest, id) ? [`${manifest[id]?.method.toUpperCase()} ${manifest[id]?.path}`] : [])),
  );
  return { isPublicBodyOperation: (method: string, path: string): boolean => targets.has(`${method} ${path}`) };
}

export function configureApp(app: NestExpressApplication, logger: Logger): void {
  app.use(requestContext);
  app.use(securityHeaders);
  app.use(requestLogging(logger));
  app.use(allowedMethods);
  app.use(globalRateLimit(app.get<RateLimiter>(RATE_LIMITER, { strict: false })));
  app.use(resolveAuthentication(app.get<SessionResolver>(SESSION_RESOLVER, { strict: false }), logger));
  app.use(jsonBody(bodyPolicy(app.get<PolicySource>(POLICY_SOURCE, { strict: false }))));
}
