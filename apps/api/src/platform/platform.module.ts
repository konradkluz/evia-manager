/**
 * Module `platform` (ADR-0001): configuration, logger, database, error boundary and technical operations (health).
 * Global, so every module can inject APP_CONFIG and LOGGER. It never imports modules from src/modules.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { AppConfig } from './config/config.ts';
import { DatabaseModule } from './database/database.module.ts';
import { HealthController } from './health/health.controller.ts';
import { ProblemFilter } from './http/problem.filter.ts';
import type { Logger } from './logging/logger.ts';
import { APP_CONFIG, LOGGER } from './tokens.ts';

export interface PlatformDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
}

@Module({})
export class PlatformModule {
  static register({ config, logger }: PlatformDependencies): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      imports: [DatabaseModule],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
      exports: [APP_CONFIG, LOGGER],
    };
  }
}
