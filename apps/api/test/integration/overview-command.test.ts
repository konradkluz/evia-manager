import { PassThrough } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runOverviewFromProcess } from '../../src/cli/overview-process.ts';
import { validEnv } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { insertProcedure } from '../support/procedure-fixtures.ts';
import { skipProjectionCheckOnce } from '../support/projection.ts';
import { insertParty } from '../support/site-fixtures.ts';
import { insertWorkOrders, numberOf } from '../support/work-order-fixtures.ts';
import { migratedDatabase, type MigratedDatabase } from './database.ts';

let database: MigratedDatabase;
beforeAll(async () => {
  database = await migratedDatabase();
});
afterAll(async () => {
  await database.close();
});

/** The whole command as the process runs it: real wiring, real database as the application role, in-memory streams. */
async function run(argv: string[]) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out: string[] = [];
  const err: string[] = [];
  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString('utf8')));
  stderr.on('data', (chunk: Buffer) => err.push(chunk.toString('utf8')));
  const code = await runOverviewFromProcess(argv, validEnv({ DATABASE_URL: database.appUrl, LOG_LEVEL: 'info' }), { stdout, stderr });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('the server command rebuild and verify as a process (EVM-034 AC6; ADR-0017 W11, T7)', () => {
  it('EVM-034 AC6 T7 verify finds the missing rows, rebuild repairs them as the application role, and the output and the log hold numbers and identifiers only', async () => {
    const customerId = await insertCustomer(database.admin, { email: 'jan@example.invalid' });
    const osd = await insertParty(database.admin, { displayName: 'Operator Nazwa Wrazliwa' });
    const ids = await insertWorkOrders(database.admin, [
      { number: numberOf(2026, 1), customerId, title: 'Tytul Wrazliwy' },
      { number: numberOf(2026, 2), customerId },
    ]);
    const [first = '', second = ''] = [...ids.values()];
    await insertProcedure(database.admin, first, {
      stages: [{ status: 'waiting', waitingOn: 'party', waitingOnPartyId: osd, waitingSince: '2026-09-18' }],
    });
    await sql`delete from overview.work_order_summaries where work_order_id = ${second}`.execute(database.admin);
    await sql`update overview.work_order_summaries set waiting_count = 0, longest_waiting_since = null,
      longest_waiting_on = null, longest_waiting_party_id = null where work_order_id = ${first}`.execute(database.admin);
    await sql`delete from overview.work_order_waits`.execute(database.admin);
    skipProjectionCheckOnce();

    const verified = await run(['verify']);
    expect(verified.code).toBe(1);
    expect(verified.stdout).toContain(`missing ${second}`);
    expect(verified.stdout).toContain(`waiting ${first}`);

    const rebuilt = await run(['rebuild']);
    expect(rebuilt.code).toBe(0);
    expect(rebuilt.stdout).toMatch(/przeliczono 2/);

    const again = await run(['verify']);
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/sprawdzono 2, zgodnych 2/);

    const everything = `${verified.stdout}${rebuilt.stdout}${again.stdout}${verified.stderr}${rebuilt.stderr}${again.stderr}`;
    expect(everything).not.toMatch(/Wrazliw|jan@example|2026-09-18/);
    const logLines = `${verified.stderr}${rebuilt.stderr}${again.stderr}`.split('\n').filter((line) => line.includes('overview:'));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) expect(JSON.parse(line)).toMatchObject({ traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as string });
  });

  it('EVM-034 AC6 an unknown command is exit 2 and nothing is read or written', async () => {
    const result = await run(['truncate']);
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/Użycie/);
  });
});
