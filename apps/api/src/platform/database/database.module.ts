import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import { APP_CONFIG, DATABASE, DATABASE_PROBE, LOGGER } from '../tokens.ts';
import { KyselyDatabaseProbe } from './database-probe.ts';
import { createDatabase, type Database } from './database.ts';

/** Closes the pool when the application shuts down. */
@Injectable()
class DatabaseLifecycle implements OnModuleDestroy {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.#db.destroy();
  }
}

@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG, LOGGER],
      useFactory: (config: AppConfig, logger: Logger) => createDatabase({ url: config.databaseUrl, logger }),
    },
    { provide: DATABASE_PROBE, inject: [DATABASE], useFactory: (db: Kysely<Database>) => new KyselyDatabaseProbe(db) },
    DatabaseLifecycle,
  ],
  exports: [DATABASE, DATABASE_PROBE],
})
export class DatabaseModule {}
