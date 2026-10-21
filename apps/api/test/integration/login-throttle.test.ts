import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteExpiredThrottles,
  deletePasswordThrottle,
  deleteThrottles,
} from '../../src/modules/identity/infrastructure/throttle-queries.ts';
import { identityTables } from '../../src/modules/identity/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { DEVICE_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';
import { PASSWORD_HASHER } from '../../src/modules/identity/infrastructure/ports.ts';
import { DATABASE, SLEEPER } from '../../src/platform/tokens.ts';
import { createIdentityApp, type IdentityApp } from '../support/identity-app.ts';
import { createLink, createUser } from '../support/identity-fixtures.ts';
import { setPassword } from '../support/flows.ts';
import { enrolledAccount, firstStep, signIn } from '../support/login-flows.ts';
import { emailHarness, outboxRows } from '../support/invitation-fixtures.ts';
import {
  accountKeyOf,
  accountRow,
  browserRow,
  CountingHasher,
  deviceIdsOf,
  InspectingSleeper,
  lockEvents,
  throttleRows,
  WRONG,
  wrongPasswords,
} from '../support/throttle-flows.ts';

/** 2026-10-05 09:00 Europe/Warsaw (CEST, UTC+2) — the instant of the scenario of the story (AC2). */
const NINE = '2026-10-05T07:00:00.000Z';
const at = (hhmm: string): string => `2026-10-05T${hhmm}:00.000Z`;
const MINUTE = 60_000;

let current: IdentityApp;
let hasher: CountingHasher;
let sleeper: InspectingSleeper;
beforeEach(async () => {
  hasher = new CountingHasher();
  sleeper = new InspectingSleeper(() => current);
  hasher.sleeper = sleeper;
  current = await createIdentityApp({
    now: NINE,
    configure: (builder) => builder.overrideProvider(PASSWORD_HASHER).useValue(hasher).overrideProvider(SLEEPER).useValue(sleeper),
  });
});
afterEach(async () => {
  await current.close();
});

const comparable = (response: Response) => {
  const { traceId, ...body } = response.body as Record<string, unknown>;
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  return { status: response.status, body, retryAfter: response.headers['retry-after'] };
};

/** The three kinds of address the first step cannot tell apart: a wrong password, an unknown address, an invited account (not active). */
async function addressCases(): Promise<Array<{ label: string; email: string; password: string }>> {
  const known = await enrolledAccount(current);
  const invited = await createUser(current.database.admin, current.clock, { role: 'editor', status: 'invited' });
  const link = await createLink(current.database.admin, current.clock, invited.id);
  expect((await setPassword(current.panel(), link.token)).status).toBe(200);
  await sql`update identity.users set status = 'deactivated' where id = ${invited.id}`.execute(current.database.admin);
  current.clock.set(NINE);
  return [
    { label: 'a wrong password', email: known.email, password: WRONG },
    { label: 'an unknown address', email: 'nobody@evia.invalid', password: WRONG },
    { label: 'a deactivated account', email: invited.email, password: WRONG },
  ];
}

describe('the delay after five failures (EVM-026 AC1; SR-AUTH-05, ASVS V6.3.1, CWE-307)', () => {
  it('EVM-026 AC1 the sixth to the tenth try wait 1, 2, 4, 8 and 10 s — the same for a wrong password, an unknown address and an account that is not active; the tenth is still 401, the eleventh 429', async () => {
    const cases = await addressCases();
    const answers = [];
    for (const attempt of cases) {
      current.clock.set(NINE);
      current.clock.advance(MINUTE * 20 * cases.indexOf(attempt)); // a window of its own, and a fresh limit of the address
      sleeper.slept.length = 0;
      const first = await wrongPasswords(current, attempt.email, 10);
      expect(
        first.map((response) => response.status),
        attempt.label,
      ).toEqual(Array<number>(10).fill(401));
      expect(sleeper.slept, attempt.label).toEqual([1000, 2000, 4000, 8000, 10_000]);
      const eleventh = await firstStepAgain(attempt.email);
      expect(eleventh.status, attempt.label).toBe(429);
      expect(eleventh.body, attempt.label).toMatchObject({ code: 'rate_limited', status: 429 });
      answers.push(comparable(eleventh));
    }
    for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0]);
    expect(Number(answers[0]?.retryAfter)).toBe(15 * 60 - 3); // locked at the tenth try, three seconds before the eleventh
  });

  it('EVM-026 AC1 the wait comes BEFORE the verification and OUTSIDE any transaction: the sixth try has waited when its Argon2id verification starts, and no connection was held', async () => {
    const [known] = await addressCases();
    hasher.verifications.length = 0;
    sleeper.slept.length = 0;
    await wrongPasswords(current, known?.email ?? '', 10);
    expect(hasher.verifications.map((run) => run.waitsBefore)).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 4, 5]);
    expect(sleeper.openTransactions).toEqual([0, 0, 0, 0, 0]);
  });

  it('EVM-026 AC1 an address is one counter whatever its case, spaces or Unicode form; the table holds an HMAC of it and neither the address nor its SHA-256', async () => {
    const known = await enrolledAccount(current, { email: 'zoe.kowalska@evia.invalid' });
    current.clock.set(NINE);
    for (const variant of ['zoe.kowalska@evia.invalid', '  ZOE.Kowalska@EVIA.invalid ', ' Zoe.KOWALSKA@evia.invalid']) {
      await wrongPasswords(current, variant, 1);
    }
    const row = await accountRow(current, known.email);
    expect(row).toMatchObject({ failures: 3, second_step_failures: 0, locked_until: null, lock_cause: null });
    expect(await throttleRows(current)).toHaveLength(1);
    const stored = JSON.stringify(
      (await sql`select to_jsonb(t) as row from identity.login_throttle t`.execute(current.database.admin)).rows,
    );
    for (const secret of [known.email, known.email.normalize('NFC')]) {
      expect(stored).not.toContain(secret);
      const digest = createHash('sha256').update(secret).digest();
      for (const encoding of ['hex', 'base64', 'base64url'] as const) expect(stored).not.toContain(digest.toString(encoding));
    }
    expect(row?.scope_key.equals(accountKeyOf(current, known.email))).toBe(true);
    expect(row?.scope).toBe('account');
  });

  it('EVM-026 AC1 a row is kept 30 minutes past the end of its window', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 1);
    const row = await accountRow(current, known.email);
    expect(row?.expires_at).toEqual(new Date(new Date(NINE).getTime() + 15 * MINUTE + 30 * MINUTE));
  });
});

/** A try after the ten failures, at the clock of the app. */
const firstStepAgain = (email: string) => firstStep(current.panel(), email, WRONG);

describe('the lock of the scenario (EVM-026 AC2; AB-01)', () => {
  it('EVM-026 AC2 ten failures between 09:00 and 09:09 lock: at 09:12 even the right password is 429 with Retry-After (one verification, against the dummy), at 09:26 it works — the same for an account and an unknown address', async () => {
    const known = await enrolledAccount(current);
    const results: Array<ReturnType<typeof comparable>> = [];
    for (const [index, email] of [known.email, 'nobody@evia.invalid'].entries()) {
      current.clock.set(at('07:00'));
      current.clock.advance(index * 40 * MINUTE);
      const base = current.clock.now().getTime();
      for (let minute = 0; minute < 10; minute += 1) {
        current.clock.set(new Date(base + minute * MINUTE));
        expect((await firstStep(current.panel(), email, WRONG)).status).toBe(401);
      }
      current.clock.set(new Date(base + 12 * MINUTE)); // 09:12
      hasher.verifications.length = 0;
      const refused = await firstStep(current.panel(), email, known.password);
      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'rate_limited' });
      expect(Number(refused.headers['retry-after'])).toBe((12 * MINUTE) / 1000); // locked at 09:09 for 15 minutes
      expect(hasher.verifications).toHaveLength(1);
      const stored = await sql<{ password_hash: string }>`select password_hash from identity.password_credentials`.execute(
        current.database.admin,
      );
      expect(stored.rows.map((row) => row.password_hash)).not.toContain(hasher.verifications[0]?.hash);
      results.push(comparable(refused));

      current.clock.set(new Date(base + 26 * MINUTE)); // 09:26
      const later = await firstStep(current.panel(), email, known.password);
      expect(later.status, email).toBe(email === known.email ? 200 : 401);
    }
    expect(results[1]).toEqual(results[0]);
  });

  it('EVM-026 AC2 a try during the lock changes nothing and does not extend it', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 10, { everyMs: 1000 });
    const locked = await accountRow(current, known.email);
    expect(locked?.lock_cause).toBe('password');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      current.clock.advance(60_000);
      expect((await firstStepAgain(known.email)).status).toBe(429);
    }
    expect(await accountRow(current, known.email)).toEqual(locked);
  });

  it('EVM-026 AC2 a correct password does not zero the counter (RR-26): the failures around it add up to ten', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 4);
    expect((await firstStep(current.panel(), known.email, known.password)).status).toBe(200);
    expect(await accountRow(current, known.email)).toMatchObject({ failures: 4, locked_until: null });
    const six = await wrongPasswords(current, known.email, 6);
    expect(six.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(await accountRow(current, known.email)).toMatchObject({ failures: 10, lock_cause: 'password' });
    expect((await firstStep(current.panel(), known.email, known.password)).status).toBe(429);
  });

  it('EVM-026 AC2 the window is fixed from the first failure: nine failures at 09:00 are forgotten at 09:15 and the counter starts again', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 9, { everyMs: 1000 });
    expect((await accountRow(current, known.email))?.failures).toBe(9);
    current.clock.set(at('07:15'));
    await wrongPasswords(current, known.email, 1);
    expect(await accountRow(current, known.email)).toMatchObject({ failures: 1, window_started_at: new Date(at('07:15')) });
  });

  it('EVM-026 AC2 twenty parallel wrong tries: at most ten reach a verdict, the rest are 429; exactly one lock, one audit event, one e-mail', async () => {
    const known = await enrolledAccount(current);
    hasher.verifications.length = 0;
    const responses = await Promise.all(Array.from({ length: 20 }, () => firstStep(current.panel(), known.email, WRONG)));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(10);
    // exactly one verification each — twenty; ten of them against the stored hash, ten against the dummy
    expect(hasher.verifications).toHaveLength(20);
    const storedHash = (
      await sql<{ password_hash: string }>`select password_hash from identity.password_credentials`.execute(current.database.admin)
    ).rows[0]?.password_hash;
    expect(hasher.verifications.filter((run) => run.hash === storedHash)).toHaveLength(10);
    expect(await accountRow(current, known.email)).toMatchObject({ failures: 10, lock_cause: 'password' });
    expect(await lockEvents(current)).toEqual([
      { action: 'account.locked', reason_code: 'password', object_id: known.user.id, actor_type: 'anonymous', outcome: 'denied' },
    ]);
    expect(await outboxRows(current, { recipient: known.user.id, kind: 'account_locked' })).toHaveLength(1);
  });
});

describe('the browser the account knows (EVM-026 AC2, M5)', () => {
  async function accountWithBrowser(options: { email?: string } = {}) {
    const account = await enrolledAccount(current, options);
    const panel = current.panel();
    expect((await signIn(panel, account)).status).toBe(200);
    current.clock.advance(61_000); // a fresh window of the limit of the address
    const [deviceId] = await deviceIdsOf(current, account.user.id);
    expect(panel.deviceCookie).toBeDefined();
    return { account, deviceCookie: panel.deviceCookie as string, deviceId: deviceId as string };
  }
  const browserWith = (deviceCookie: string | undefined) => {
    const panel = current.panel();
    panel.deviceCookie = deviceCookie;
    return panel;
  };

  it('EVM-026 AC2 the lock of the browsers the account does not know does not touch the browser it knows: that one still signs in, and it has a counter of its own', async () => {
    const { account, deviceCookie, deviceId } = await accountWithBrowser();
    await wrongPasswords(current, account.email, 10);
    expect((await firstStepAgain(account.email)).status).toBe(429);
    const known = await firstStep(browserWith(deviceCookie), account.email, account.password);
    expect(known.status).toBe(200);
    expect(await browserRow(current, deviceId)).toMatchObject({ failures: 0, scope: 'browser' });

    // its own lock works the same way — and then the browsers the account does not know are still locked by their own counter
    current.clock.advance(MINUTE);
    await wrongPasswords(current, account.email, 10, { panel: () => browserWith(deviceCookie) });
    expect(await browserRow(current, deviceId)).toMatchObject({ failures: 10, lock_cause: 'password' });
    expect((await firstStep(browserWith(deviceCookie), account.email, account.password)).status).toBe(429);
    expect((await lockEvents(current)).map((event) => event.action)).toEqual(['account.locked', 'account.browser_locked']);
  });

  it('EVM-026 AC4 the lock of a browser the account knows is told as that: the variant of the browser, and an e-mail that names THIS browser and says that the others are not covered', async () => {
    const { account, deviceCookie } = await accountWithBrowser();
    await wrongPasswords(current, account.email, 10, { panel: () => browserWith(deviceCookie) });
    const rows = await outboxRows(current, { recipient: account.user.id, kind: 'account_locked' });
    expect(rows.map((row) => row.variant)).toEqual(['browser_password']);
    const harness = emailHarness(current);
    await harness.job.run({ ids: rows.map((row) => row.id) });
    expect(harness.sender.sent).toHaveLength(1);
    const { subject, text } = harness.sender.sent[0] ?? { subject: '', text: '' };
    expect(subject).toBe('EVia Manager: logowanie zablokowane na 15 minut');
    expect(text).toContain('z przeglądarki, której Twoje konto używa na co dzień, od ');
    expect(text).toContain('Ta blokada dotyczy tylko tej przeglądarki');
    expect(text).not.toContain('z nieznanych przeglądarek');
    expect(text).not.toContain('nie jest zablokowane');
    expect(text).not.toMatch(/#|token/i);
  });

  it('EVM-026 AC2 the browsers the account does not know cannot be kept signed out by the tries from a browser it knows (and the other way round)', async () => {
    const { account, deviceCookie } = await accountWithBrowser();
    await wrongPasswords(current, account.email, 10, { panel: () => browserWith(deviceCookie) });
    expect((await firstStep(browserWith(deviceCookie), account.email, account.password)).status).toBe(429);
    expect((await firstStep(current.panel(), account.email, account.password)).status).toBe(200);
  });

  it('EVM-026 M5 the cookie of ANOTHER account is no cookie: the tries count against the account, not against the browser of the colleague, so he cannot make a fresh budget', async () => {
    const victim = await accountWithBrowser();
    const colleague = await accountWithBrowser();
    await wrongPasswords(current, victim.account.email, 3, { panel: () => browserWith(colleague.deviceCookie) });
    expect(await accountRow(current, victim.account.email)).toMatchObject({ failures: 3, scope: 'account' });
    expect(await browserRow(current, colleague.deviceId)).toBeUndefined();
    expect(await browserRow(current, victim.deviceId)).toBeUndefined();
    await wrongPasswords(current, victim.account.email, 7, { panel: () => browserWith(colleague.deviceCookie) });
    expect((await firstStep(browserWith(colleague.deviceCookie), victim.account.email, victim.account.password)).status).toBe(429);
    current.clock.advance(61_000); // a fresh window of the limit of the address
    // the victim's own browser is not locked
    expect((await firstStep(browserWith(victim.deviceCookie), victim.account.email, victim.account.password)).status).toBe(200);
  });

  it.each([
    ['malformed', 'not-a-token'],
    ['unknown', 'A'.repeat(43)],
  ])('EVM-026 M5 a %s cookie is no cookie: the tries count against the account', async (_label, value) => {
    const { account } = await accountWithBrowser();
    await wrongPasswords(current, account.email, 2, { panel: () => browserWith(`${DEVICE_COOKIE_NAME}=${value}`) });
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 2 });
  });

  it('EVM-026 M5 two cookies of the name are no cookie (one may be planted)', async () => {
    const { account, deviceCookie } = await accountWithBrowser();
    const doubled = `${deviceCookie}; ${deviceCookie.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'))}`;
    await wrongPasswords(current, account.email, 1, { panel: () => browserWith(doubled) });
    expect(await accountRow(current, account.email)).toMatchObject({ failures: 1 });
  });
});

describe('the lift of a lock never waits for a sign-in (EVM-026 AC7; CWE-833)', () => {
  it('EVM-026 AC7 a counter that a sign-in holds locked is skipped by the end of a reset, and so are the counters of forgotten browsers: no deadlock between users → counter and counter → users', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 10, { everyMs: 1000 });
    const key = accountKeyOf(current, known.email);
    const app = identityTables(current.app.get<Kysely<Database>>(DATABASE, { strict: false }));
    await current.database.admin.transaction().execute(async (trx) => {
      await sql`select 1 from identity.login_throttle where scope_key = ${key} for update`.execute(trx);
      expect(await deletePasswordThrottle(app, key)).toBe(false); // returned at once — it did not queue behind the lock
      await deleteThrottles(app, [key]);
    });
    expect(await accountRow(current, known.email)).toMatchObject({ failures: 10, lock_cause: 'password' });
    expect(await deletePasswordThrottle(app, key)).toBe(true);
    expect(await accountRow(current, known.email)).toBeUndefined();
  });

  it('EVM-026 AC7 the retention skips a counter that a sign-in holds locked instead of waiting for it (CWE-833) and deletes it on the next run', async () => {
    const known = await enrolledAccount(current);
    current.clock.set(NINE);
    await wrongPasswords(current, known.email, 1);
    const key = accountKeyOf(current, known.email);
    const app = identityTables(current.app.get<Kysely<Database>>(DATABASE, { strict: false }));
    const later = new Date(new Date(NINE).getTime() + 60 * MINUTE);
    await current.database.admin.transaction().execute(async (trx) => {
      await sql`select 1 from identity.login_throttle where scope_key = ${key} for update`.execute(trx);
      await deleteExpiredThrottles(app, later); // returned at once — it did not queue behind the lock
      expect(await accountRow(current, known.email)).toBeDefined();
    });
    expect(await deleteExpiredThrottles(app, later)).toBeGreaterThanOrEqual(1);
    expect(await accountRow(current, known.email)).toBeUndefined();
  });
});
