import { describe, expect, it } from 'vitest';
import { FakeSession, USER_A, USER_B, noteInput } from './helpers.ts';
import { SERVER_NOW, aggregate, cur, iso, makePull, page, uid, type PullHarness } from './pull-helpers.ts';

const DAY = 86_400_000;
const wo = (n: number): string => uid('work_order', n);
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function seeded(h: PullHarness): Promise<void> {
  h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
  await h.pull.pull();
}

describe('session and pauses shared with the push side (EVM-092 AC4)', () => {
  it('EVM-092 AC4: 401 session_revoked on pull pauses push as well, removes the replica at once and leaves the queue byte for byte', async () => {
    const h = makePull();
    await seeded(h);
    await h.core.queue.enqueue(noteInput(wo(1)));
    const queueBefore = JSON.stringify(h.queue.data);
    h.transport.changesScript.push({ kind: 'http', status: 401, code: 'session_revoked' });
    const result = await h.pull.pull();
    expect(result.status).toBe('paused');
    expect(result.paused).toBe('session_revoked');
    expect(Object.keys(h.replica.active().entities)).toHaveLength(0);
    expect(h.replica.disk.data.owner).toBeNull();
    expect(JSON.stringify(h.queue.data)).toBe(queueBefore);
    expect((await h.core.engine.flush()).paused).toBe('session_revoked');
    expect(h.server.requests).toHaveLength(0);
    expect(h.events).toContainEqual({ kind: 'replica_wiped', reason: 'session_revoked' });
    expect(h.events.filter((e) => e.kind === 'signal' && e.signal === 'session_revoked')).toHaveLength(1);
  });

  it('EVM-092 AC4: resume after session_revoked works for both sides only for the same user', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push({ kind: 'http', status: 401, code: 'session_revoked' });
    await h.pull.pull();
    h.session.userId = USER_B;
    expect(await h.core.engine.resume()).toBe(false);
    expect((await h.pull.pull()).status).toBe('paused');
    h.session.userId = USER_A;
    expect(await h.core.engine.resume()).toBe(true);
    h.transport.changesScript.push(page(aggregate(2), { cursor: 2 }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.replica.has('work_order', wo(2))).toBe(true);
    expect(h.replica.disk.data.owner).toBe(USER_A);
  });

  it('EVM-092 AC4: session_revoked noticed by push pauses pull and wipes the replica (queue stays)', async () => {
    const h = makePull();
    await seeded(h);
    await h.core.queue.enqueue(noteInput(wo(1)));
    h.server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    await h.core.engine.flush();
    const result = await h.pull.pull();
    expect(result.status).toBe('paused');
    expect(h.transport.changeRequests).toHaveLength(1);
    expect(Object.keys(h.replica.active().entities)).toHaveLength(0);
    expect(h.queue.records()).toHaveLength(1);
  });

  it('EVM-092 AC4: a wipe that failed after session_revoked is retried before anything else; until then the cycle is a store failure', async () => {
    const h = makePull();
    await seeded(h);
    h.replica.failOn = { method: 'wipeReplica', call: 1 };
    h.server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    await h.core.queue.enqueue(noteInput(wo(1)));
    await h.core.engine.flush();
    expect(h.replica.has('work_order', wo(1))).toBe(true);
    h.replica.failOn = { method: 'wipeReplica', call: 2 };
    expect((await h.pull.pull()).status).toBe('retry');
    expect(h.replica.has('work_order', wo(1))).toBe(true);
    await h.pull.pull();
    expect(h.replica.has('work_order', wo(1))).toBe(false);
  });

  it('EVM-092 AC4: 426 and 403 on pull pause push too; resume is common', async () => {
    for (const [status, reason] of [
      [426, 'upgrade_required'],
      [403, 'forbidden'],
    ] as const) {
      const h = makePull();
      h.transport.changesScript.push({ kind: 'http', status });
      const result = await h.pull.pull();
      expect(result.paused).toBe(reason);
      await h.core.queue.enqueue(noteInput(wo(1)));
      expect((await h.core.engine.flush()).paused).toBe(reason);
      expect(h.server.requests).toHaveLength(0);
      expect(await h.core.engine.resume()).toBe(true);
      await h.core.engine.flush();
      expect(h.server.requests).toHaveLength(1);
    }
  });

  it('EVM-092 AC4: device_wipe_required stops at once: nothing is applied, no contact is recorded, the signal is raised once, the replica is left to the host wipe', async () => {
    const h = makePull();
    await seeded(h);
    const contactCalls = h.replica.calls['saveContact'];
    const applyCalls = h.replica.calls['applyPage'];
    h.transport.changesScript.push({ kind: 'http', status: 401, code: 'device_wipe_required' });
    const result = await h.pull.pull();
    expect(result.paused).toBe('device_wipe_required');
    expect(h.replica.calls['saveContact']).toBe(contactCalls);
    expect(h.replica.calls['applyPage']).toBe(applyCalls);
    expect(h.replica.calls['wipeReplica']).toBeUndefined();
    await h.pull.pull();
    expect(await h.core.engine.resume()).toBe(false);
    expect(h.events.filter((e) => e.kind === 'signal' && e.signal === 'device_wipe_required')).toHaveLength(1);
  });

  it('EVM-092 AC4: a response fetched before session_revoked of the push side is dropped when it arrives later (no applyPage, no contact)', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.transport.changesScript.push(async () => {
      await held;
      return page(aggregate(9), { cursor: 5 });
    });
    const pulling = h.pull.pull();
    await tick();
    h.server.script.push({ kind: 'http', status: 401, code: 'session_revoked' });
    await h.core.engine.flush();
    release();
    const result = await pulling;
    expect(result.status).toBe('paused');
    expect(h.replica.calls['applyPage']).toBeUndefined();
    expect(h.replica.calls['saveContact']).toBeUndefined();
    expect(h.replica.has('work_order', wo(9))).toBe(false);
  });

  it('EVM-092 AC4: a pause that happens between reading and writing a page stops before the write', async () => {
    const h = makePull();
    await seeded(h);
    h.transport.changesScript.push(page(aggregate(3), { cursor: 2 }));
    h.session.userId = USER_A;
    const original = h.replica.readVersions.bind(h.replica);
    h.replica.readVersions = async (generation, keys) => {
      const out = await original(generation, keys);
      h.server.script.push({ kind: 'http', status: 426 });
      await h.core.queue.enqueue(noteInput(wo(1)));
      await h.core.engine.flush();
      return out;
    };
    const result = await h.pull.pull();
    expect(result.status).toBe('paused');
    expect(h.replica.has('work_order', wo(3))).toBe(false);
  });

  it('EVM-092 AC4: a replica of another user is never read or extended: signal, wipe first, then a download for the signed-in user (queue of the other user stays)', async () => {
    const session = new FakeSession(USER_A);
    const first = makePull({ session });
    await seeded(first);
    await first.core.queue.enqueue(noteInput(wo(1)));
    const queueBefore = JSON.stringify(first.queue.data);
    session.userId = USER_B;
    const second = makePull({ disk: first.replica.disk, queue: first.queue, session });
    second.transport.changesScript.push(page(aggregate(4), { cursor: 7 }));
    await second.pull.pull();
    expect(second.events).toContainEqual({ kind: 'signal', signal: 'owner_mismatch' });
    expect(second.replica.log.slice(0, 3)).toEqual(['loadState', 'wipeReplica', 'loadState']);
    expect(second.replica.has('work_order', wo(1))).toBe(false);
    expect(second.replica.has('work_order', wo(4))).toBe(true);
    expect(second.replica.disk.data.owner).toBe(USER_B);
    expect(JSON.stringify(second.queue.data)).toBe(queueBefore);
  });

  it('EVM-092 AC4: data without an owner (unknown origin) is removed before any download', async () => {
    const h = makePull();
    await seeded(h);
    h.replica.disk.data.owner = null;
    h.transport.changesScript.push(page(aggregate(4), { cursor: 7 }));
    await h.pull.pull();
    expect(h.replica.has('work_order', wo(1))).toBe(false);
    expect(h.replica.has('work_order', wo(4))).toBe(true);
    expect(h.events.some((e) => e.kind === 'signal' && e.signal === 'owner_mismatch')).toBe(false);
  });

  it('EVM-092 AC4: a failed wipe for a different owner stops the cycle: nothing of the other user is extended or shown', async () => {
    const session = new FakeSession(USER_A);
    const first = makePull({ session });
    await seeded(first);
    session.userId = USER_B;
    const second = makePull({ disk: first.replica.disk, session });
    second.replica.failOn = { method: 'wipeReplica', call: 1 };
    expect((await second.pull.pull()).status).toBe('retry');
    expect(second.transport.changeRequests).toHaveLength(0);
  });

  it('EVM-092 AC4: 401 without a code triggers one refresh and one retry; failed refresh pauses with auth_required; revoked refresh with session_revoked', async () => {
    const h = makePull();
    h.transport.changesScript.push({ kind: 'http', status: 401 }, page(aggregate(1), { cursor: 1 }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.session.refreshCalls).toBe(1);
    const h2 = makePull();
    h2.session.refreshResult = 'unavailable';
    h2.transport.changesScript.push({ kind: 'http', status: 401 });
    expect((await h2.pull.pull()).paused).toBe('auth_required');
    const h3 = makePull();
    h3.session.refreshResult = 'session_revoked';
    h3.transport.changesScript.push({ kind: 'http', status: 401 });
    expect((await h3.pull.pull()).paused).toBe('session_revoked');
    const h4 = makePull();
    h4.transport.changesScript.push({ kind: 'http', status: 401 }, { kind: 'http', status: 401 });
    expect((await h4.pull.pull()).paused).toBe('auth_required');
  });

  it('EVM-092 AC4: without a signed-in user pull pauses with auth_required and sends nothing', async () => {
    const h = makePull({ session: new FakeSession(null) });
    expect((await h.pull.pull()).paused).toBe('auth_required');
    expect(h.transport.changeRequests).toHaveLength(0);
    expect(h.transport.configCalls).toBe(0);
  });
});

describe('the whole cycle (EVM-092 AC4)', () => {
  it('EVM-092 AC4: one cycle sends the queue first and then pulls; parallel triggers share the running cycle (one extra round at most)', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }), page([], { cursor: 2 }));
    const [a, b] = await Promise.all([h.core.sync(), h.core.sync()]);
    expect(h.server.requests).toHaveLength(1);
    expect(a.pull?.status).toBe('complete');
    expect(b.flush.settled).toBeGreaterThanOrEqual(0);
    expect(h.queue.records()).toHaveLength(0);
    expect(h.replica.log.indexOf('applyPage')).toBeGreaterThan(-1);
  });

  it('EVM-092 AC4: a pause found by push stops the pull of the same cycle; a push-only core still works', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    h.server.script.push({ kind: 'http', status: 426 });
    const result = await h.core.sync();
    expect(result.flush.paused).toBe('upgrade_required');
    expect(result.pull).toBeUndefined();
    expect(h.transport.changeRequests).toHaveLength(0);
  });

  it('EVM-092 AC4: a trigger that arrives while the cycle runs causes one more round', async () => {
    const h = makePull();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.transport.changesScript.push(
      async () => {
        await held;
        return page(aggregate(1), { cursor: 1 });
      },
      page([], { cursor: 2 }),
    );
    const first = h.core.sync();
    await tick();
    const second = h.core.sync({ networkRestored: true });
    release();
    await Promise.all([first, second]);
    expect(h.transport.changeRequests).toHaveLength(2);
  });
});

describe('transient errors and backoff', () => {
  it('EVM-092 AC4: a network error gives a retry with backoff; the next cycle before the time waits unless the network is back', async () => {
    const h = makePull();
    h.transport.changesScript.push({ kind: 'network' });
    const first = await h.pull.pull();
    expect(first.status).toBe('retry');
    expect(first.nextAttemptAt).toBeGreaterThan(SERVER_NOW);
    expect((await h.pull.pull()).status).toBe('backoff');
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    expect((await h.pull.pull({ networkRestored: true })).status).toBe('complete');
    expect((await h.pull.pull({ networkRestored: true })).status).not.toBe('backoff');
  });

  it('EVM-092 AC4: 429 with Retry-After, 408 and 5xx are retried later; the waiting time is at least Retry-After', async () => {
    for (const [status, code] of [
      [429, 'rate_limited'],
      [408, 'timeout'],
      [503, 'server_error'],
    ] as const) {
      const h = makePull();
      h.transport.changesScript.push({ kind: 'http', status, retryAfter: '120' });
      const result = await h.pull.pull();
      expect(result.status).toBe('retry');
      expect((result.nextAttemptAt ?? 0) - SERVER_NOW).toBeGreaterThanOrEqual(120_000);
      expect(h.events.some((e) => e.kind === 'pull_retry_scheduled' && e.code === code)).toBe(true);
      expect((await h.pull.pull({ networkRestored: true })).status).toBe('backoff');
    }
  });

  it('EVM-092 AC4: an unexpected status (400 without cursor reasons, 404 on the feed or on the config, 418) pauses with unexpected_response', async () => {
    for (const status of [400, 404, 418]) {
      const h = makePull();
      h.transport.changesScript.push({ kind: 'http', status });
      expect((await h.pull.pull()).paused).toBe('unexpected_response');
    }
    const h = makePull();
    h.transport.config = { kind: 'http', status: 404 };
    expect((await h.pull.pull()).paused).toBe('unexpected_response');
  });

  it('EVM-092 AC4: a transport that throws counts as a network error; a store that throws is a store failure without any message in the telemetry', async () => {
    const h = makePull();
    h.transport.changesScript.push(() => {
      throw new Error('synthetic secret message');
    });
    expect((await h.pull.pull()).status).toBe('retry');
    const h2 = makePull();
    h2.replica.loadState = () => Promise.reject(new Error('synthetic secret message'));
    expect((await h2.pull.pull()).status).toBe('retry');
    expect(JSON.stringify([...h.events, ...h2.events])).not.toContain('synthetic secret');
    expect(h2.events).toContainEqual(expect.objectContaining({ kind: 'pull_retry_scheduled', code: 'store_failure' }));
  });
});

describe('client configuration and last contact (EVM-092 AC7)', () => {
  it('EVM-092 AC7: the configuration is fetched when missing, validated, stored, and refreshed only after its age', async () => {
    const h = makePull();
    h.transport.config = {
      kind: 'ok',
      body: { offlineContactWindowDays: 99, closedWorkOrdersInScopeDays: 10, periodicResyncDays: 0, scopeRuleVersion: 'v-1' },
    };
    h.transport.changesScript.push(page([], { cursor: 1 }), page([], { cursor: 2 }), page([], { cursor: 3 }));
    await h.pull.pull();
    await h.pull.pull();
    expect(h.transport.configCalls).toBe(1);
    expect(h.replica.disk.data.config).toMatchObject({
      offlineContactWindowDays: 7,
      closedWorkOrdersInScopeDays: 10,
      periodicResyncDays: 7,
      scopeRuleVersion: 'v-1',
    });
    h.clock.advance(7 * 3_600_000);
    await h.pull.pull();
    expect(h.transport.configCalls).toBe(2);
  });

  it('EVM-092 AC7: the window of the configuration shortens the offline limit but never extends it beyond 7 days', async () => {
    const h = makePull();
    h.transport.config = { kind: 'ok', body: { offlineContactWindowDays: 2 } };
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    await h.pull.pull();
    expect(await h.pull.visibility()).toEqual({ visible: true });
    h.mono.mono += 3 * DAY;
    h.clock.advance(3 * DAY);
    expect(await h.pull.visibility()).toEqual({ visible: false, reason: 'window_elapsed' });
    expect(h.events).toContainEqual({ kind: 'data_hidden', reason: 'window_elapsed' });
    const h2 = makePull();
    h2.transport.config = { kind: 'ok', body: { offlineContactWindowDays: 30 } };
    h2.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    await h2.pull.pull();
    h2.mono.mono += 8 * DAY;
    h2.clock.advance(8 * DAY);
    expect((await h2.pull.visibility()).visible).toBe(false);
  });

  it('EVM-092 AC7: without a stored configuration the default window of 7 days applies', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    await h.pull.pull();
    h.replica.disk.data.config = null;
    h.mono.mono += 6 * DAY;
    h.clock.advance(6 * DAY);
    expect((await h.pull.visibility()).visible).toBe(true);
    h.mono.mono += 2 * DAY;
    h.clock.advance(2 * DAY);
    expect((await h.pull.visibility()).visible).toBe(false);
  });

  it('EVM-092 AC7: the contact is recorded after an authenticated 2xx page with its server time, monotonic time and boot id', async () => {
    const h = makePull();
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1, serverTime: SERVER_NOW - 90_000 }));
    await h.pull.pull();
    expect(h.replica.disk.data.contact).toMatchObject({ v: 1, serverTime: SERVER_NOW - 90_000, bootId: 'boot-1', mono: 1000, carried: 0 });
  });

  it('EVM-092 AC7: a resync_required answer (2xx) is a contact too', async () => {
    const h = makePull();
    await seeded(h);
    h.clock.advance(1000);
    h.transport.changesScript.push(
      { kind: 'ok', body: { result: 'resync_required', reason: 'periodic', serverTime: iso(SERVER_NOW + 1000) } },
      page([], { phase: 'changes', cursor: 9, hasMore: false }),
    );
    await h.pull.pull();
    expect(h.replica.calls['saveContact']).toBeGreaterThanOrEqual(2);
  });

  it('EVM-092 AC7: no contact is recorded for network errors, 3xx, 4xx, 5xx, 401, 426, malformed bodies or the push side without a time', async () => {
    const outcomes = [
      { kind: 'network' },
      { kind: 'http', status: 302 },
      { kind: 'http', status: 400 },
      { kind: 'http', status: 401, code: 'session_revoked' },
      { kind: 'http', status: 403 },
      { kind: 'http', status: 404 },
      { kind: 'http', status: 426 },
      { kind: 'http', status: 429 },
      { kind: 'http', status: 503 },
      { kind: 'ok', body: { result: 'changes', phase: 'changes', changes: [], cursor: cur(1), hasMore: false } },
    ] as const;
    for (const outcome of outcomes) {
      const h = makePull();
      h.transport.changesScript.push(outcome);
      await h.pull.pull();
      expect(h.replica.disk.data.contact, JSON.stringify(outcome)).toBeNull();
    }
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    h.server.script.push({ kind: 'ok', body: { results: [] } });
    await h.core.engine.flush();
    expect(h.replica.disk.data.contact).toBeNull();
  });

  it('EVM-092 AC7: a 2xx answer of the push side with a server time records the contact (one place for push and pull)', async () => {
    const h = makePull();
    await h.core.queue.enqueue(noteInput(wo(1)));
    await h.core.engine.flush();
    expect(h.replica.disk.data.contact).toMatchObject({ v: 1, serverTime: Date.UTC(2026, 9, 29, 8, 0, 0) });
  });

  it('EVM-092 AC7: a contact that cannot be saved is reported without breaking the cycle', async () => {
    const h = makePull();
    h.replica.failOn = { method: 'saveContact', call: 1 };
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    expect((await h.pull.pull()).status).toBe('complete');
    expect(h.events).toContainEqual({ kind: 'pull_failed', code: 'contact_not_saved' });
  });

  it('EVM-092 AC7: a non-empty replica without a contact record is hidden; after a clock set back the data are hidden (not wiped)', async () => {
    const h = makePull();
    await seeded(h);
    h.replica.disk.data.contact = { garbage: true };
    expect(await h.pull.visibility()).toEqual({ visible: false, reason: 'no_contact_record' });
    h.transport.changesScript.push(page([], { cursor: 2 }));
    await h.pull.pull();
    expect((await h.pull.visibility()).visible).toBe(true);
    h.mono.boot = 'boot-2';
    h.clock.advance(-DAY);
    expect(await h.pull.visibility()).toEqual({ visible: false, reason: 'clock_anomaly' });
    expect(h.replica.has('work_order', wo(1))).toBe(true);
  });

  it('EVM-092 AC7: the clock of the phone a minute behind the server does not hide data after restarts', async () => {
    const h = makePull();
    h.clock.advance(-60_000);
    h.transport.changesScript.push(page(aggregate(1), { cursor: 1 }));
    await h.pull.pull();
    for (let boot = 2; boot < 5; boot += 1) {
      h.mono.boot = `boot-${boot}`;
      h.clock.advance(3_600_000);
      expect((await h.pull.visibility()).visible).toBe(true);
    }
  });
});
