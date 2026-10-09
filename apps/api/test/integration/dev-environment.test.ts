/**
 * The tools of the local environment against a real PostgreSQL (EVM-077 AC4, AC5, AC7): the guard in the database (the marker
 * stored on the database itself, not forgeable by a session), the state of the Administrator and the demo data written through
 * the use cases of the domain. The tool is started like by the orchestrator: through `runDevCli` with the environment of the
 * local setup, connecting to 127.0.0.1:5442 — here a forwarder to the test server, because the guard accepts that address only.
 */
import { randomBytes } from 'node:crypto';
import { createServer, connect, type Server } from 'node:net';
import { Writable } from 'node:stream';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { MIGRATIONS } from '../../src/migrations/index.ts';
import { createDatabase, type Database } from '../../src/platform/database/database.ts';
import { migrateToLatest } from '../../src/platform/database/migrator.ts';
import { createLogger } from '../../src/platform/logging/logger.ts';
import { administratorState, activeAdministrator } from '../../dev/administrator.ts';
import { readDatabaseFacts } from '../../dev/database-facts.ts';
import { databaseProblems, MARKER } from '../../dev/guard.ts';
import { defaultDeps, EXIT_ERROR, EXIT_OK, EXIT_REFUSED, runDevCli } from '../../dev/run.ts';
import { CUSTOMERS, ORDERS, PARTIES, SITES } from '../../dev/seed/data.ts';
import { FixedClock } from '../support/clock.ts';
import { createUser } from '../support/identity-fixtures.ts';
import { validEnv } from '../support/app.ts';

const logger = createLogger({ level: 'fatal' });
const DEV_PORT = 5442;

function capture(): Writable & { text(): string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  return Object.assign(stream, { text: () => chunks.join('') });
}

let server: Server;
let admin: Kysely<Database>;
let devUrl: string;
let serverUrl: URL;

/** The URL the tool is given: exactly the local setup (loopback, port 5442, database evia_dev). */
const toolUrl = (): string => {
  const url = new URL(serverUrl);
  url.hostname = '127.0.0.1';
  url.port = String(DEV_PORT);
  url.pathname = '/evia_dev';
  return url.toString();
};

function localEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...validEnv({ NODE_ENV: 'development', WEBAUTHN_RP_ID: 'localhost', PANEL_ORIGIN: 'http://localhost:5173' }),
    CURSOR_KEY: randomBytes(32).toString('base64url'),
    DATABASE_URL: toolUrl(),
    ...overrides,
  };
}

async function run(command: string, env = localEnv()): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = capture();
  const stderr = capture();
  const code = await runDevCli([command], env, { stdout, stderr }, await defaultDeps());
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

/** Row counts of the tables the seed writes to (fixed statements — no dynamic identifiers). */
const COUNTS = {
  customers: () => sql<{ n: string }>`select count(*)::text as n from customers.customers`,
  parties: () => sql<{ n: string }>`select count(*)::text as n from parties.parties`,
  sites: () => sql<{ n: string }>`select count(*)::text as n from sites.sites`,
  orders: () => sql<{ n: string }>`select count(*)::text as n from work_orders.work_orders`,
  scopeItems: () => sql<{ n: string }>`select count(*)::text as n from work_orders.scope_items`,
};
const count = async (table: keyof typeof COUNTS): Promise<number> => {
  const { rows } = await COUNTS[table]().execute(admin);
  return Number(rows[0]?.n);
};

beforeAll(async () => {
  const adminUrl = new URL(inject('adminDatabaseUrl'));
  serverUrl = adminUrl;
  const maintenance = createDatabase({ url: adminUrl.toString(), logger, pool: { max: 1 } });
  try {
    await sql`drop database if exists evia_dev with (force)`.execute(maintenance);
    await sql`create database evia_dev template template1`.execute(maintenance);
  } finally {
    await maintenance.destroy();
  }
  devUrl = new URL(adminUrl.toString()).toString().replace(/\/[^/]*$/, '/evia_dev');
  admin = createDatabase({ url: devUrl, logger, pool: { max: 4 } });
  await migrateToLatest(admin, MIGRATIONS);

  // A forwarder from 127.0.0.1:5442 to the test server (the guard accepts only the address of the local setup).
  server = createServer((client) => {
    const upstream = connect({ host: adminUrl.hostname, port: Number(adminUrl.port || 5432) });
    client.pipe(upstream);
    upstream.pipe(client);
    const close = (): void => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close);
    upstream.on('error', close);
  });
  await new Promise<void>((resolve) => {
    server.listen(DEV_PORT, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await admin.destroy();
});

/** The statement of infra/docker/postgres-dev/init.sql (tools/repo-policy checks that the file holds exactly this statement). */
const applyInitScript = async (): Promise<void> => {
  await sql`alter database evia_dev set evia.env = 'local-dev'`.execute(admin);
};

describe('the guard in the database (EVM-077 AC4)', () => {
  it('EVM-077 AC4: without the marker the tool refuses before any write, with a message and exit 3', async () => {
    const before = await count('customers');
    const result = await run('seed');
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain('brak znacznika środowiska lokalnego');
    expect(result.stdout).toBe('');
    expect(await count('customers')).toBe(before);
    expect((await run('state')).code).toBe(EXIT_REFUSED);
  });

  it('EVM-077 AC4 (M2): a marker set only in the session (options=, PGOPTIONS-like) does not count — only the setting stored on the database does', async () => {
    const session = createDatabase({
      url: `${devUrl}${devUrl.includes('?') ? '&' : '?'}options=-c%20evia.env%3Dlocal-dev`,
      logger,
      pool: { max: 1 },
    });
    try {
      const { rows } = await sql<{ value: string }>`select current_setting('evia.env') as value`.execute(session);
      expect(rows[0]?.value).toBe('local-dev'); // the session says so ...
      const facts = await readDatabaseFacts(session);
      expect(facts).toEqual({ currentDatabase: 'evia_dev', databaseSettings: null }); // ... the database does not
      expect(databaseProblems(facts).map((problem) => problem.code)).toEqual(['db-marker']);
    } finally {
      await session.destroy();
    }
    // a setting for one role in this database is not the marker of the database either
    await sql`alter role evia in database evia_dev set evia.env = 'local-dev'`.execute(admin);
    try {
      expect(databaseProblems(await readDatabaseFacts(admin)).map((problem) => problem.code)).toEqual(['db-marker']);
      expect((await run('state')).code).toBe(EXIT_REFUSED);
    } finally {
      await sql`alter role evia in database evia_dev reset evia.env`.execute(admin);
    }
  });

  it('EVM-077 AC4: another database name is refused at the server (the name comes from current_database())', async () => {
    const other = createDatabase({ url: inject('adminDatabaseUrl'), logger, pool: { max: 1 } });
    try {
      const facts = await readDatabaseFacts(other);
      expect(facts.currentDatabase).not.toBe('evia_dev');
      expect(databaseProblems({ ...facts, databaseSettings: [MARKER] }).map((problem) => problem.code)).toEqual(['db-name']);
    } finally {
      await other.destroy();
    }
  });

  it('EVM-077 AC4: the environment is refused first — a different database in the URL never reaches the connection', async () => {
    const result = await run('state', localEnv({ DATABASE_URL: toolUrl().replace('evia_dev', 'evia') }));
    expect(result.code).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain('nazwa bazy musi być evia_dev');
    const withHost = await run('state', localEnv({ DATABASE_URL: `${toolUrl()}?host=db.example.com` }));
    expect(withHost.code).toBe(EXIT_REFUSED);
    expect((await run('state', localEnv({ NODE_ENV: 'test' }))).code).toBe(EXIT_REFUSED);
    expect((await run('state', localEnv({ PGOPTIONS: '-c evia.env=local-dev' }))).code).toBe(EXIT_REFUSED);
  });

  it('EVM-077 AC4: an invalid configuration is reported by the names of the variables only', async () => {
    const result = await run('state', localEnv({ CURSOR_KEY: 'too-short' }));
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain('CURSOR_KEY');
    expect(result.stderr).not.toContain('too-short');
  });

  it('EVM-077 AC4: an unreachable server is a plain error without the address or the driver message', async () => {
    const stdout = capture();
    const stderr = capture();
    const deps = await defaultDeps();
    const code = await runDevCli(
      ['state'],
      localEnv(),
      { stdout, stderr },
      {
        ...deps,
        openDatabase: () => createDatabase({ url: 'postgres://u:secret-pass@127.0.0.1:1/evia_dev', logger, pool: { max: 1 } }),
      },
    );
    expect(code).toBe(EXIT_ERROR);
    expect(stderr.text()).toContain('operacja na bazie dev nie powiodła się');
    expect(stderr.text()).not.toMatch(/secret-pass|127\.0\.0\.1/);
  });

  it('EVM-077 AC4: usage errors do nothing', async () => {
    const stderr = capture();
    expect(await runDevCli(['seed', 'extra'], localEnv(), { stdout: capture(), stderr }, await defaultDeps())).toBe(2);
    expect(await runDevCli(['drop'], localEnv(), { stdout: capture(), stderr }, await defaultDeps())).toBe(2);
    expect(await runDevCli([], localEnv(), { stdout: capture(), stderr }, await defaultDeps())).toBe(2);
  });
});

describe('the Administrator and the demo data (EVM-077 AC5, AC7)', () => {
  it('EVM-077 AC5: the state follows the account — none, invited, active (a deactivated one counts as none)', async () => {
    await applyInitScript();
    expect(await administratorState(admin)).toBe('none');
    expect(JSON.parse((await run('state')).stdout)).toEqual({ guard: 'ok', admin: 'none' });
    const clock = new FixedClock('2026-10-09T08:00:00.000Z');
    await createUser(admin, clock, { role: 'administrator', status: 'deactivated', email: 'deaktywowany@example.test' });
    expect(await administratorState(admin)).toBe('none');
    await createUser(admin, clock, { role: 'editor', status: 'active', email: 'edytor@example.test' });
    expect(await administratorState(admin)).toBe('none');
    const invited = await createUser(admin, clock, { role: 'administrator', status: 'invited', email: 'zaproszony@example.test' });
    expect(JSON.parse((await run('state')).stdout)).toEqual({ guard: 'ok', admin: 'invited' });
    expect(await activeAdministrator(admin)).toBeUndefined();
    await sql`update identity.users set status = 'active' where id = ${invited.id}`.execute(admin);
    expect(JSON.parse((await run('state')).stdout)).toEqual({ guard: 'ok', admin: 'active' });
    expect(await activeAdministrator(admin)).toEqual({ userId: invited.id });
  });

  it('EVM-077 AC7: the demo data are created through the use cases — customers, sites with parties, orders in different statuses — and only counts are printed', async () => {
    const result = await run('seed');
    expect(result.code).toBe(EXIT_OK);
    const total = PARTIES.length + CUSTOMERS.length + SITES.length + ORDERS.length;
    expect(JSON.parse(result.stdout)).toEqual({ created: total, existing: 0 });
    // no record, name, address or e-mail on the screen
    expect(result.stdout + result.stderr).not.toMatch(/example\.test|Demonstracyjn|Przykładow|ul\./);

    expect(await count('customers')).toBe(CUSTOMERS.length);
    expect(await count('parties')).toBe(PARTIES.length);
    expect(await count('sites')).toBe(SITES.length);
    expect(await count('orders')).toBe(ORDERS.length);
    const statuses = await sql<{ status: string; n: string }>`
      select status, count(*)::text as n from work_orders.work_orders group by status order by status`.execute(admin);
    expect(statuses.rows.map((row) => row.status)).toEqual(['accepted', 'completed', 'in_progress', 'new', 'quoting']);
    // two orders in one site: "other orders at this site" is not empty
    const crowded = await sql<{
      n: string;
    }>`select count(*)::text as n from work_orders.work_orders group by site_id order by n desc limit 1`.execute(admin);
    expect(Number(crowded.rows[0]?.n)).toBeGreaterThanOrEqual(2);
    // scope items were copied from existing templates
    expect(await count('scopeItems')).toBeGreaterThan(0);
  });

  it('EVM-077 AC7: the audit trail names the active Administrator as the actor and the terminal command as the origin — no web channel, no IP', async () => {
    const author = await activeAdministrator(admin);
    const events = await sql<{
      actor_type: string;
      actor_user_id: string | null;
      origin: string;
      ip_prefix: string | null;
      action: string;
    }>`
      select actor_type, actor_user_id, origin, ip_prefix, action from audit.events
      where action like 'customer.%' or action like 'site.%' or action like 'party.%' or action like 'work_order.%'`.execute(admin);
    expect(events.rows.length).toBeGreaterThanOrEqual(CUSTOMERS.length + SITES.length + PARTIES.length + ORDERS.length);
    for (const row of events.rows) {
      expect(row.actor_type).toBe('user');
      expect(row.actor_user_id).toBe(author?.userId);
      expect(row.origin).toBe('cli');
      expect(row.ip_prefix).toBeNull();
    }
  });

  it('EVM-077 AC7: the data are synthetic — reserved e-mail domains, no PESEL, the tax number is absent', async () => {
    const customers = await sql<{ email: string | null; phone: string; tax_id: string | null }>`
      select email, phone, tax_id from customers.customers`.execute(admin);
    for (const row of customers.rows) {
      if (row.email !== null) expect(row.email).toMatch(/@example\.test$/);
      expect(row.phone).toMatch(/^\+48000/);
      expect(row.tax_id).toBeNull();
    }
  });

  it('EVM-077 AC7: a repeat creates no duplicates and does not touch what was entered by hand or changed since', async () => {
    await sql`update customers.customers set notes = 'zmienione ręcznie' where id = ${CUSTOMERS[0].id}`.execute(admin);
    await sql`update work_orders.work_orders set status = 'on_hold' where id = ${ORDERS[0]?.id ?? ''}`.execute(admin);
    const total = PARTIES.length + CUSTOMERS.length + SITES.length + ORDERS.length;
    const again = await run('seed');
    expect(again.code).toBe(EXIT_OK);
    expect(JSON.parse(again.stdout)).toEqual({ created: 0, existing: total });
    expect(await count('customers')).toBe(CUSTOMERS.length);
    expect(await count('orders')).toBe(ORDERS.length);
    const note = await sql<{ notes: string }>`select notes from customers.customers where id = ${CUSTOMERS[0].id}`.execute(admin);
    expect(note.rows[0]?.notes).toBe('zmienione ręcznie');
    const order = await sql<{ status: string }>`select status from work_orders.work_orders where id = ${ORDERS[0]?.id ?? ''}`.execute(
      admin,
    );
    expect(order.rows[0]?.status).toBe('on_hold');
  });

  it('EVM-077 AC7 (Konrad 2026-10-09): without an active Administrator nothing is written and the answer says so', async () => {
    await sql`update identity.users set status = 'invited' where role = 'administrator' and status = 'active'`.execute(admin);
    const before = await count('customers');
    const result = await run('seed');
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual({ created: 0, existing: 0 });
    expect(result.stderr).toContain('Brak aktywnego Administratora');
    expect(await count('customers')).toBe(before);
  });
});
