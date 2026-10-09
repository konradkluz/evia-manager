/**
 * The real wiring of the seed: the application context of the API (the same modules, no HTTP server — as the server command
 * of EVM-016) and the use cases of the domain. It is process wiring around `seedDemoData`, tested by the integration run.
 */
import 'reflect-metadata';
import type { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import { sql, type Kysely } from 'kysely';
import { AppModule } from '../src/app.module.ts';
import { CreateCustomerService } from '../src/modules/customers/application/create-customer.service.ts';
import { CreatePartyService } from '../src/modules/parties/application/create-party.service.ts';
import { CreateSiteService } from '../src/modules/sites/application/create-site.service.ts';
import { CreateWorkOrderService } from '../src/modules/work-orders/application/create-work-order.service.ts';
import { TransitionWorkOrderService } from '../src/modules/work-orders/application/transition-work-order.service.ts';
import type { AppConfig } from '../src/platform/config/config.ts';
import type { Database } from '../src/platform/database/database.ts';
import { newTraceId } from '../src/platform/http/request-context.ts';
import { createLogger } from '../src/platform/logging/logger.ts';
import { NestLoggerAdapter } from '../src/platform/logging/nest-logger.ts';
import { DATABASE } from '../src/platform/tokens.ts';
import { seedDemoData, seedPrincipal, type SeedCounts } from './seed/run.ts';

/** The active templates in the order of the catalogue (the seed copies their scope into the demo orders). */
async function activeTemplateIds(db: Kysely<Database>): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    select id from catalog.work_order_templates where is_active and deleted_at is null order by position limit 3`.execute(db);
  return rows.map((row) => row.id);
}

export async function seedWithApplication(config: AppConfig, administratorId: string, stderr: Writable): Promise<SeedCounts> {
  // Whatever the application logs goes to stderr and only from warn up.
  const logger = createLogger({ level: 'warn', destination: stderr });
  const app = await NestFactory.createApplicationContext(AppModule.register({ config, logger }), { logger: new NestLoggerAdapter(logger) });
  try {
    const get = <T>(token: new (...args: never[]) => T): T => app.get(token, { strict: false });
    const db = app.get<Kysely<Database>>(DATABASE, { strict: false });
    return await seedDemoData(
      {
        parties: get(CreatePartyService),
        customers: get(CreateCustomerService),
        sites: get(CreateSiteService),
        orders: get(CreateWorkOrderService),
        transitions: get(TransitionWorkOrderService),
      },
      seedPrincipal(administratorId, new Date()),
      await activeTemplateIds(db),
      { origin: 'cli', traceId: newTraceId() },
    );
  } finally {
    await app.close();
  }
}
