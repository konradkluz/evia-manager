/**
 * Module `platform` (ADR-0001): configuration, logger, database, clock, event bus, metrics, rate limiter, error boundary and technical operations (health).
 * Global, so every module can inject APP_CONFIG and LOGGER. It never imports modules from src/modules.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { AppConfig } from './config/config.ts';
import { SystemClock, type Clock } from './clock/clock.ts';
import { SecurityAlertEmitter } from './alerts/security-alerts.ts';
import { DatabaseModule } from './database/database.module.ts';
import type { Database } from './database/database.ts';
import type { Kysely } from 'kysely';
import { HealthController } from './health/health.controller.ts';
import { EventBus } from './events/event-bus.ts';
import { ProblemFilter } from './http/problem.filter.ts';
import { IDEMPOTENCY, PgIdempotency } from './idempotency/idempotency.ts';
import { IDEMPOTENCY_PURGER, PgIdempotencyPurger } from './idempotency/idempotency-purger.ts';
import { PurgeIdempotencyJob } from './idempotency/purge-idempotency.job.ts';
import { InMemoryRateLimiter, RATE_LIMITER } from './http/rate-limiter.ts';
import { TimerSleeper } from './http/response-floor.ts';
import type { Logger } from './logging/logger.ts';
import { MetricsRegistry } from './metrics/metrics.ts';
import { BulkReadControl } from './bulk-read/bulk-read-control.ts';
import { InMemoryBulkReadMeter, type BulkReadMeter } from './bulk-read/bulk-read-meter.ts';
import { InMemoryDistinctReadMeter, type DistinctReadMeter } from './bulk-read/distinct-read-meter.ts';
import { CursorCodec } from './crypto/opaque-cursor.ts';
import {
  APP_CONFIG,
  BULK_READ_CONTROL,
  BULK_READ_METER,
  DISTINCT_READ_METER,
  CLOCK,
  CURSOR_CODEC,
  DATABASE,
  EVENT_BUS,
  LOGGER,
  METRICS,
  SECURITY_ALERT_EMITTER,
  SLEEPER,
} from './tokens.ts';
import { runInTransaction } from './database/transactional.ts';

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
        { provide: CLOCK, useClass: SystemClock },
        { provide: SLEEPER, useClass: TimerSleeper },
        { provide: EVENT_BUS, useValue: new EventBus() },
        { provide: METRICS, useValue: new MetricsRegistry() },
        {
          provide: SECURITY_ALERT_EMITTER,
          inject: [DATABASE, LOGGER, CLOCK],
          useFactory: (db: Kysely<Database>, logger: Logger, clock: Clock) => new SecurityAlertEmitter(db, logger, clock),
        },
        {
          provide: CURSOR_CODEC,
          inject: [CLOCK],
          useFactory: (clock: Clock) => new CursorCodec(config.cursorKey, clock),
        },
        { provide: BULK_READ_METER, inject: [CLOCK], useFactory: (clock: Clock) => new InMemoryBulkReadMeter(clock) },
        { provide: DISTINCT_READ_METER, inject: [CLOCK], useFactory: (clock: Clock) => new InMemoryDistinctReadMeter(clock) },
        {
          provide: BULK_READ_CONTROL,
          inject: [BULK_READ_METER, DISTINCT_READ_METER, LOGGER, METRICS, DATABASE, EVENT_BUS],
          useFactory: (
            meter: BulkReadMeter,
            distinct: DistinctReadMeter,
            logger: Logger,
            metrics: MetricsRegistry,
            db: Kysely<Database>,
            events: EventBus,
          ) =>
            new BulkReadControl(meter, distinct, logger, metrics, (event, context) =>
              runInTransaction(db, (transaction) => events.publish(transaction, event, context)),
            ),
        },
        { provide: RATE_LIMITER, inject: [CLOCK], useFactory: (clock: Clock) => new InMemoryRateLimiter(clock) },
        {
          provide: IDEMPOTENCY,
          inject: [CLOCK, METRICS],
          useFactory: (clock: Clock, metrics: MetricsRegistry) => new PgIdempotency(clock, metrics),
        },
        {
          provide: IDEMPOTENCY_PURGER,
          inject: [DATABASE, CLOCK],
          useFactory: (db: Kysely<Database>, clock: Clock) => new PgIdempotencyPurger(db, clock),
        },
        PurgeIdempotencyJob,
      ],
      exports: [
        DatabaseModule,
        APP_CONFIG,
        LOGGER,
        CLOCK,
        SLEEPER,
        EVENT_BUS,
        METRICS,
        RATE_LIMITER,
        IDEMPOTENCY,
        PurgeIdempotencyJob,
        SECURITY_ALERT_EMITTER,
        CURSOR_CODEC,
        BULK_READ_CONTROL,
      ],
    };
  }
}
