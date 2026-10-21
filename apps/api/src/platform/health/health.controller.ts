/**
 * Public technical operations (SR-API-12):
 * - GET /api/health (EVM-008 AC1) `getHealth`: only the status and the minimum supported mobile app version — no versions of libraries, host,
 *   database name or timings. A database failure gives 503 service_unavailable without details.
 * - GET /api/version (EVM-007 AC4, AC6) `getVersion`: the commit of the image and the SHA-256 of the release manifest, read by the deployment
 *   channel before it switches traffic and by staging-verify. Nothing else: no build time, versions or host.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import type { Health, Version } from '@evia/contracts';
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

  @Get('/api/version')
  @OperationId('getVersion')
  getVersion(): Version {
    const { commit, manifestSha256 } = this.#config.release;
    return { commit, manifestSha256 };
  }
}
