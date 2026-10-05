/**
 * GET /api/health (EVM-008 AC1; SR-API-12): public technical operation `getHealth`. Answers only the status and the
 * minimum supported mobile app version — no versions of libraries, host, database name or timings. A database
 * failure gives 503 service_unavailable without details.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import type { Health } from '@evia/contracts';
import type { AppConfig } from '../config/config.ts';
import type { DatabaseProbe } from '../database/database-probe.ts';
import { OperationId } from '../http/operation-id.ts';
import { ProblemException } from '../http/problem.ts';
import type { Logger } from '../logging/logger.ts';
import { APP_CONFIG, DATABASE_PROBE, LOGGER } from '../tokens.ts';

@Controller()
export class HealthController {
  readonly #probe: DatabaseProbe;
  readonly #config: AppConfig;
  readonly #logger: Logger;

  constructor(@Inject(DATABASE_PROBE) probe: DatabaseProbe, @Inject(APP_CONFIG) config: AppConfig, @Inject(LOGGER) logger: Logger) {
    this.#probe = probe;
    this.#config = config;
    this.#logger = logger;
  }

  @Get('/api/health')
  @OperationId('getHealth')
  async getHealth(): Promise<Health> {
    try {
      await this.#probe.ping();
    } catch (error) {
      this.#logger.warn({ err: error }, 'health: database unavailable');
      throw new ProblemException('service_unavailable');
    }
    const { android, ios } = this.#config.minSupportedAppVersion;
    return { status: 'ok', minSupportedAppVersion: { android, ios } };
  }
}
