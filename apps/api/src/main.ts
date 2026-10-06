/**
 * Entry point of the API process (`node dist/src/main.js` after `pnpm --filter @evia/api run build`). Fail-fast
 * configuration, JSON logger, last-resort process handlers, then the application built by createApiApp() (all wiring
 * lives there and is tested). Migrations are not run here.
 */
import 'reflect-metadata';
import { createApiApp } from './app.ts';
import { loadConfig } from './platform/config/config.ts';
import { requestContextMixin } from './platform/http/request-context.ts';
import { createLogger } from './platform/logging/logger.ts';
import { installProcessHandlers } from './platform/process/process-handlers.ts';

/* v8 ignore start -- process entry point: configuration, listening on the port */
if (import.meta.main) {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, mixin: requestContextMixin });
  installProcessHandlers(process, logger);
  const app = await createApiApp(config, logger);
  await app.listen(config.port);
  logger.info({ port: config.port }, 'api listening');
}
/* v8 ignore stop */
