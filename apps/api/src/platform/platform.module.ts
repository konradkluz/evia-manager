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
import { InMemorySignedUrlMeters } from './signed-url-limits/signed-url-meters.ts';
import { InMemoryBulkReadMeter, type BulkReadMeter } from './bulk-read/bulk-read-meter.ts';
import { InMemoryDistinctReadMeter, type DistinctReadMeter } from './bulk-read/distinct-read-meter.ts';
import { fieldEncryptionFor } from './crypto/field-encryption.ts';
import { BoundedDeletionRegister, REGISTER_WRITE_LIMITS } from './deletion-register/bounded-deletion-register.ts';
import { DELETION_REGISTER } from './deletion-register/deletion-register.ts';
import { deletionRegisterFor, REGISTER_FAILURES_METRIC } from './deletion-register/deletion-register-factory.ts';
import { CursorCodec } from './crypto/opaque-cursor.ts';
import {
  APP_CONFIG,
  BULK_READ_CONTROL,
  BULK_READ_METER,
  SIGNED_URL_METERS,
  DISTINCT_READ_METER,
  CLOCK,
  CURSOR_CODEC,
  FIELD_ENCRYPTION,
  DATABASE,
  EVENT_BUS,
  LOGGER,
  METRICS,
  SECURITY_ALERT_EMITTER,
  SLEEPER,
} from './tokens.ts';
import { runInTransaction } from './database/transactional.ts';
import { createImageProcessor } from './media-processing/create-image-processor.ts';
import { IMAGE_PROCESSOR } from './media-processing/image-processor.ts';
import { createVideoProcessor } from './media-processing/create-video-processor.ts';
import { VIDEO_PROCESSOR } from './media-processing/video-processor.ts';
import { createMalwareScanner } from './malware-scan/create-malware-scanner.ts';
import { MALWARE_SCANNER } from './malware-scan/malware-scanner.ts';
import { createObjectStorage } from './object-storage/create-object-storage.ts';
import { OBJECT_STORAGE } from './object-storage/object-storage.ts';

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
        { provide: FIELD_ENCRYPTION, useFactory: () => fieldEncryptionFor(config.fieldEncryptionKeys) },
        // EVM-044: both are `null` without the media configuration (fail closed: the upload answers 503, nothing is scanned or served)
        { provide: OBJECT_STORAGE, useFactory: () => createObjectStorage(config.media) },
        { provide: MALWARE_SCANNER, useFactory: () => createMalwareScanner(config.media) },
        // EVM-068: `null` without the processor settings - no derivatives are made and the photos stay `clean`
        { provide: IMAGE_PROCESSOR, useFactory: () => createImageProcessor(config.media) },
        // EVM-046: `null` without the work area of videos - the films stay `clean` and their originals are not released (fail closed)
        { provide: VIDEO_PROCESSOR, useFactory: () => createVideoProcessor(config.media) },
        { provide: BULK_READ_METER, inject: [CLOCK], useFactory: (clock: Clock) => new InMemoryBulkReadMeter(clock) },
        { provide: SIGNED_URL_METERS, inject: [CLOCK], useFactory: (clock: Clock) => new InMemorySignedUrlMeters(clock) },
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
        {
          provide: DELETION_REGISTER,
          inject: [CLOCK, LOGGER, METRICS],
          useFactory: (clock: Clock, logger: Logger, metrics: MetricsRegistry) =>
            new BoundedDeletionRegister(
              deletionRegisterFor(config.deletionRegister, clock, logger, metrics),
              REGISTER_WRITE_LIMITS,
              metrics.counter(REGISTER_FAILURES_METRIC, ['reason']),
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
        FIELD_ENCRYPTION,
        BULK_READ_CONTROL,
        OBJECT_STORAGE,
        MALWARE_SCANNER,
        IMAGE_PROCESSOR,
        VIDEO_PROCESSOR,
        DELETION_REGISTER,
        SIGNED_URL_METERS,
      ],
    };
  }
}
