/**
 * Test helpers of the API (EVM-008): synthetic configuration and an in-memory log destination. No real data —
 * passwords and versions below are synthetic.
 */
import { Writable } from 'node:stream';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.ts';
import { configureApp, createHttpAdapter } from '../../src/app.ts';
import { loadConfig, type AppConfig } from '../../src/platform/config/config.ts';
import { requestContextMixin } from '../../src/platform/http/request-context.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { NestLoggerAdapter } from '../../src/platform/logging/nest-logger.ts';

/** A database that refuses connections immediately (nothing listens on port 1) — no DNS, no waiting. */
export const UNREACHABLE_DATABASE_URL = 'postgres://evia:evia-test@127.0.0.1:1/evia';

/** Synthetic origin of the panel in tests (an HTTPS origin, as in production). */
export const PANEL_ORIGIN = 'https://panel.evia.test';

/** Synthetic test key of the cursors (32 identical bytes — a placeholder the production configuration refuses). Test use only. */
export const TEST_CURSOR_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

export function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: UNREACHABLE_DATABASE_URL,
    MIN_SUPPORTED_APP_VERSION_ANDROID: '1.2.0',
    MIN_SUPPORTED_APP_VERSION_IOS: '1.1.0',
    PANEL_ORIGIN: PANEL_ORIGIN,
    WEBAUTHN_RP_ID: 'panel.evia.test',
    CURSOR_KEY: TEST_CURSOR_KEY,
    ...overrides,
  };
}

/** Collects pino output lines (JSON) for assertions. */
export class LogCapture extends Writable {
  readonly lines: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    callback();
  }

  get entries(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  get text(): string {
    return this.lines.join('\n');
  }
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly logs: LogCapture;
  readonly config: AppConfig;
  close(): Promise<void>;
}

export interface TestAppOptions {
  readonly env?: Record<string, string | undefined>;
  /** Extra test-only modules (never part of AppModule in production). */
  readonly imports?: ModuleMetadata['imports'];
  readonly configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Builds the API exactly like src/main.ts (AppModule + configureApp), without listening on a port. */
export async function createTestApp({ env = {}, imports = [], configure = (builder) => builder }: TestAppOptions = {}): Promise<TestApp> {
  const config = loadConfig(validEnv(env));
  const logs = new LogCapture();
  const logger = createLogger({ level: 'info', destination: logs, mixin: requestContextMixin });
  const moduleRef = await configure(Test.createTestingModule({ imports: [AppModule.register({ config, logger }), ...imports] })).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config.trustedProxies), {
    bodyParser: false,
    logger: new NestLoggerAdapter(logger),
  });
  configureApp(app, logger);
  await app.init();
  return { app, logs, config, close: () => app.close() };
}
