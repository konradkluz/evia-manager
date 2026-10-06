/**
 * The API under test with a real PostgreSQL (integration): migrated by the owner, used through the application role,
 * with a controlled clock and a fake of Pwned Passwords — no test ever sends traffic to the real service (A7). Everything
 * else is the production wiring (AppModule + configureApp).
 */
import { BREACHED_PASSWORD_CHECK, type BreachedPasswordCheck, type BreachResult } from '../../src/modules/identity/infrastructure/ports.ts';
import { CLOCK } from '../../src/platform/tokens.ts';
import { migratedDatabase, type MigratedDatabase } from '../integration/database.ts';
import { createTestApp, type TestApp } from './app.ts';
import { FixedClock } from './clock.ts';

/** Records what would leave the process and answers with a fixed verdict. */
export class FakeBreachedPasswords implements BreachedPasswordCheck {
  result: BreachResult = 'clean';
  readonly checked: string[] = [];

  check(password: string): Promise<BreachResult> {
    this.checked.push(password);
    return Promise.resolve(this.result);
  }
}

export interface IdentityApp extends TestApp {
  readonly database: MigratedDatabase;
  readonly clock: FixedClock;
  readonly breaches: FakeBreachedPasswords;
}

/** 2026-10-01 10:00 Europe/Warsaw (CEST, UTC+2) — the instant of the clock scenarios in the story (AC5). */
export const ISSUED_AT = '2026-10-01T08:00:00.000Z';

export async function createIdentityApp(options: { now?: string; env?: Record<string, string | undefined> } = {}): Promise<IdentityApp> {
  const database = await migratedDatabase();
  const clock = new FixedClock(options.now ?? ISSUED_AT);
  const breaches = new FakeBreachedPasswords();
  const app = await createTestApp({
    env: { DATABASE_URL: database.appUrl, ...options.env },
    configure: (builder) => builder.overrideProvider(CLOCK).useValue(clock).overrideProvider(BREACHED_PASSWORD_CHECK).useValue(breaches),
  });
  return {
    ...app,
    database,
    clock,
    breaches,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}
