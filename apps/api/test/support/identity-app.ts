/**
 * The API under test with a real PostgreSQL (integration): migrated by the owner, used through the application role,
 * with a controlled clock and a fake of Pwned Passwords — no test ever sends traffic to the real service (A7). Everything
 * else is the production wiring (AppModule + configureApp).
 */
import type { ModuleMetadata } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'kysely';
import { BREACHED_PASSWORD_CHECK, type BreachedPasswordCheck, type BreachResult } from '../../src/modules/identity/infrastructure/ports.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { migratedDatabase, type MigratedDatabase } from '../integration/database.ts';
import { createTestApp, PANEL_ORIGIN, type TestApp } from './app.ts';
import { FixedClock } from './clock.ts';
import { createLink, createUser, type LinkFixture, type UserFixture } from './identity-fixtures.ts';
import { PanelClient } from './panel-client.ts';

/** Records what would leave the process and answers with a fixed verdict. */
export class FakeBreachedPasswords implements BreachedPasswordCheck {
  result: BreachResult = 'clean';
  readonly checked: string[] = [];

  check(password: string): Promise<BreachResult> {
    this.checked.push(password);
    return Promise.resolve(this.result);
  }
}

interface Row {
  row: string;
}

export interface IdentityApp extends TestApp {
  readonly database: MigratedDatabase;
  readonly clock: FixedClock;
  readonly breaches: FakeBreachedPasswords;
  /** A browser of the panel talking to this API. */
  panel(): PanelClient;
  /** An invited Administrator with an unused activation link (what the server command leaves behind). */
  pendingAdministrator(options?: { email?: string; ttlMs?: number }): Promise<{ user: UserFixture; link: LinkFixture }>;
  /** Every row of every table the story touches, as text — to prove that a request changed nothing. */
  snapshot(): Promise<string>;
}

/** 2026-10-01 10:00 Europe/Warsaw (CEST, UTC+2) — the instant of the clock scenarios in the story (AC5). */
export const ISSUED_AT = '2026-10-01T08:00:00.000Z';

export interface IdentityAppOptions {
  readonly now?: string;
  readonly env?: Record<string, string | undefined>;
  readonly imports?: ModuleMetadata['imports'];
  readonly configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createIdentityApp(options: IdentityAppOptions = {}): Promise<IdentityApp> {
  const database = await migratedDatabase();
  const clock = new FixedClock(options.now ?? ISSUED_AT);
  const breaches = new FakeBreachedPasswords();
  const app = await createTestApp({
    env: { DATABASE_URL: database.appUrl, ...options.env },
    ...(options.imports === undefined ? {} : { imports: options.imports }),
    configure: (builder) => {
      const base = builder.overrideProvider(CLOCK).useValue(clock).overrideProvider(BREACHED_PASSWORD_CHECK).useValue(breaches);
      return options.configure === undefined ? base : options.configure(base);
    },
  });
  return {
    ...app,
    database,
    clock,
    breaches,
    panel: () => new PanelClient(app.app.getHttpServer(), PANEL_ORIGIN),
    pendingAdministrator: async ({ email, ttlMs }: { email?: string; ttlMs?: number } = {}) => {
      const user = await createUser(database.admin, clock, {
        role: 'administrator',
        status: 'invited',
        ...(email === undefined ? {} : { email }),
      });
      const link = await createLink(database.admin, clock, user.id, ttlMs === undefined ? {} : { ttlMs });
      return { user, link };
    },
    snapshot: async () => {
      const tables = [
        sql<Row>`select to_jsonb(t)::text as row from identity.users t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from identity.password_credentials t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from identity.passkeys t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from identity.one_time_links t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from identity.sessions t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from identity.webauthn_challenges t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from audit.events t order by 1`,
        sql<Row>`select to_jsonb(t)::text as row from platform.security_alert_outbox t order by 1`,
      ];
      const parts: string[][] = [];
      for (const query of tables) parts.push((await query.execute(database.admin)).rows.map((row) => row.row));
      return JSON.stringify(parts);
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
