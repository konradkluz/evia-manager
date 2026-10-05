/**
 * Entry point of the API process (`node dist/src/main.js` after `pnpm --filter @evia/api run build`). Fail-fast
 * configuration, JSON logger, last-resort process handlers, the shared HTTP pipeline. Migrations are not run here.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.ts';
import { configureApp, createHttpAdapter } from './app.ts';
import { loadConfig } from './platform/config/config.ts';
import { requestContextMixin } from './platform/http/request-context.ts';
import { createLogger } from './platform/logging/logger.ts';
import { NestLoggerAdapter } from './platform/logging/nest-logger.ts';
import { installProcessHandlers } from './platform/process/process-handlers.ts';

/* v8 ignore start -- process wiring of the API entry point; configureApp() and the modules are covered by tests */
if (import.meta.main) {
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel, mixin: requestContextMixin });
  installProcessHandlers(process, logger);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ config, logger }), createHttpAdapter(), {
    bodyParser: false,
    logger: new NestLoggerAdapter(logger),
  });
  configureApp(app, logger);
  app.enableShutdownHooks();
  await app.listen(config.port);
  logger.info({ port: config.port }, 'api listening');
}
/* v8 ignore stop */
