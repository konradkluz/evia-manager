import { SessionGate } from '@evia/sync-core';
import type { SessionEnded } from '../../src/auth/ports';
import { MobileSessionOwner } from '../../src/auth/session-owner';
import { DEVICE_1, DEVICE_2, T0, USER_A, USER_B, secret, token } from './fixtures';
import { FakeAuthClient, FakeClock, issued, newPhone, ok, problem, signedIn, start, unavailable, type Phone } from './fakes';

const DAY = 86_400_000;
let phone: Phone;
beforeEach(() => {
  phone = newPhone();
});

const ended = (rig: { owner: MobileSessionOwner }): SessionEnded[] => {
  const list: SessionEnded[] = [];
  rig.owner.onSessionEnded((event) => list.push(event));
  return list;
};
/** Lets every queued promise of the owner run (real timers). */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
const pending = (): string[] => JSON.parse(phone.slots.get('revocationToken') ?? '[]') as string[];

describe('sign-in commit (EVM-100 AC1; architect 1, security W2)', () => {
  it('EVM-100 AC1: after step 2 the store is opened first, then identity → refresh token → session record; the access token stays in memory', async () => {
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'signed_in' });
    expect(rig.host.opened).toEqual([USER_A]);
    expect(phone.log).toEqual(['identity.write', 'set:refreshToken', 'set:sessionMeta']);
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(1) });
    expect(phone.slots.get('refreshToken')).toBe(token('refresh-1'));
    const stored = [...phone.slots.values()].join('|');
    expect(stored).not.toContain(token('access-1'));
    expect(stored).not.toContain('@');
    expect(JSON.parse(phone.slots.get('sessionMeta') ?? '{}')).toMatchObject({
      v: 1,
      userId: USER_A,
      displayName: 'Piotr Testowy',
      role: 'editor',
    });
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    expect(rig.owner.displayName()).toBe('Piotr Testowy');
    expect(rig.client.calls).toEqual([]);
  });

  it.each(['owner_mismatch', 'data_lost', 'unavailable', 'update_required', 'wipe_incomplete'] as const)(
    'EVM-100 AC1: an open result %s stores nothing and sends nothing with the new tokens — it goes to the device check',
    async (kind) => {
      if (kind === 'owner_mismatch') phone.owner = USER_B;
      else phone.openAs = kind;
      const rig = start(phone);
      const step = await rig.owner.completeSignIn(issued());
      expect(step.kind).toBe('device_check');
      if (step.kind === 'device_check') expect(step.result.kind).toBe(kind);
      expect(phone.log).toEqual([]);
      expect(phone.slots.size).toBe(0);
      expect(await rig.owner.currentUserId()).toBeNull();
      expect(await rig.owner.accessToken()).toBeNull();
      expect(rig.client.calls).toEqual([]);
      await rig.owner.abandonSignIn();
      expect(rig.client.calls).toEqual([`logout:${token('access-1')}`]);
      expect(phone.slots.size).toBe(0);
      expect(await rig.owner.continueDeviceCheck({ kind: 'wipe_incomplete' })).toEqual({
        kind: 'device_check',
        result: { kind: 'wipe_incomplete' },
      });
    },
  );

  it('EVM-100 AC1: after data_lost and "Rozumiem" the identity of step 2 is written into the NEW store only', async () => {
    phone.identity = { deviceId: DEVICE_2, secret: secret(9) };
    phone.openAs = 'data_lost';
    const rig = start(phone);
    const step = await rig.owner.completeSignIn(issued());
    if (step.kind !== 'device_check' || step.result.kind !== 'data_lost') throw new Error('expected data_lost');
    expect(phone.log).toEqual([]);
    const reopened = await step.result.acknowledge();
    expect(await rig.owner.continueDeviceCheck(reopened)).toEqual({ kind: 'signed_in' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(1) });
    expect(phone.log).toEqual(['identity.write', 'set:refreshToken', 'set:sessionMeta']);
  });

  it('EVM-100 AC1 (SR-MOB-13): a store unlocked for another user than the session of step 2 is not used', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    phone.openAs = null;
    const other = await rig.host.openForUser(USER_B);
    expect(await rig.owner.continueDeviceCheck(other)).toEqual({ kind: 'failed' });
    expect(phone.slots.size).toBe(0);
  });

  it('EVM-100 AC1 (RR-69): when the new secret cannot be stored the sign-in fails, the old secret stays and no token is kept', async () => {
    phone.identity = { deviceId: DEVICE_1, secret: secret(0) };
    phone.faults.set('identity.write', 'fail');
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(0) });
    expect(phone.slots.size).toBe(0);
    expect(phone.log).toEqual(['lock']);
  });

  it('EVM-100 AC1: a refresh token or a session record that cannot be stored leaves no session behind', async () => {
    phone.faults.set('set:refreshToken', 'fail');
    expect(await start(phone).owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(phone.slots.size).toBe(0);
    phone.faults.set('set:sessionMeta', 'fail');
    expect(await start(phone).owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
  });

  it('EVM-100 AC1: a session without a new secret keeps the stored identity; a session not issued by the adapter is refused', async () => {
    phone.identity = { deviceId: DEVICE_1, secret: secret(0) };
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued({ withSecret: false }))).toEqual({ kind: 'signed_in' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(0) });
    expect(await start(newPhone()).owner.completeSignIn(Object.create(null) as never)).toEqual({ kind: 'failed' });
  });

  it('EVM-100 AC1: a process killed between any two writes of the sign-in restarts with no session or with the whole one, never half', async () => {
    for (const write of ['identity.write', 'set:refreshToken', 'set:sessionMeta']) {
      phone = newPhone();
      phone.faults.set(write, 'crash');
      await start(phone)
        .owner.completeSignIn(issued())
        .catch(() => undefined);
      phone.dead = false;
      const restarted = start(phone);
      const step = await restarted.owner.restore();
      if (step.kind === 'signed_in') {
        expect(phone.slots.has('refreshToken') && phone.slots.has('sessionMeta')).toBe(true);
      } else {
        expect(step).toEqual({ kind: 'signed_out' });
        expect(phone.slots.has('refreshToken')).toBe(false);
        expect(phone.slots.has('sessionMeta')).toBe(false);
        expect(await restarted.owner.currentUserId()).toBeNull();
      }
      expect(restarted.client.calls).toEqual([]);
    }
  });
});

describe('a session of step 2 that is not kept is ended on the server (EVM-100 AC1; code review: device limit, RR-72)', () => {
  it('EVM-100 AC1: abandoning the device check logs the session of step 2 out at once; nothing is stored', async () => {
    phone.owner = USER_B;
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    await rig.owner.abandonSignIn();
    expect(rig.client.calls).toEqual([`logout:${token('access-1')}`]);
    expect(phone.slots.size).toBe(0);
    await rig.owner.abandonSignIn();
    expect(rig.client.calls).toHaveLength(1);
  });

  it('EVM-100 AC1: abandoning without a session of step 2 sends nothing', async () => {
    const rig = start(phone);
    await rig.owner.abandonSignIn();
    expect(rig.client.calls).toEqual([]);
    expect(phone.slots.size).toBe(0);
  });

  it('EVM-100 AC1: a logout that fails on the network keeps the refresh token of step 2 as a pending revocation, sent at the next connection', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    rig.client.logoutScript.push(unavailable);
    await rig.owner.abandonSignIn();
    expect(pending()).toEqual([token('refresh-1')]);
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([`logout:${token('access-1')}`, `refresh:${token('refresh-1')}`, `logout:${token('access-2')}`]);
    expect(phone.slots.has('revocationToken')).toBe(false);
  });

  it.each([
    ['500', problem(500, 'internal')],
    ['429', problem(429, 'rate_limited')],
    ['426', problem(426, 'update_required')],
  ] as const)('EVM-100 AC1: a logout answered %s keeps the pending revocation', async (_label, outcome) => {
    phone.openAs = 'update_required';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    rig.client.logoutScript.push(outcome);
    await rig.owner.abandonSignIn();
    expect(pending()).toEqual([token('refresh-1')]);
  });

  it('EVM-100 AC1: a logout answered 401/403 needs no pending revocation (the session is already over)', async () => {
    for (const outcome of [problem(401, 'session_revoked'), problem(403, 'forbidden')]) {
      phone = newPhone();
      phone.openAs = 'wipe_incomplete';
      const rig = start(phone);
      await rig.owner.completeSignIn(issued());
      rig.client.logoutScript.push(outcome);
      await rig.owner.abandonSignIn();
      expect(phone.slots.has('revocationToken')).toBe(false);
    }
  });

  it('EVM-100 AC1: a pending revocation that cannot be stored does not break the abandon', async () => {
    phone.openAs = 'unavailable';
    phone.faults.set('set:revocationToken', 'fail');
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    rig.client.logoutScript.push(unavailable);
    await expect(rig.owner.abandonSignIn()).resolves.toBeUndefined();
    expect(phone.slots.size).toBe(0);
  });

  it('EVM-100 AC1: a logout that throws is treated like no network (the pending revocation stays)', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    rig.client.logout = () => Promise.reject(new Error('boom'));
    await expect(rig.owner.abandonSignIn()).resolves.toBeUndefined();
    expect(pending()).toEqual([token('refresh-1')]);
  });

  it('EVM-100 AC1: a store unlocked for another user ends the session of step 2 on the server', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    phone.openAs = null;
    const other = await rig.host.openForUser(USER_B);
    expect(await rig.owner.continueDeviceCheck(other)).toEqual({ kind: 'failed' });
    expect(rig.client.calls).toEqual([`logout:${token('access-1')}`]);
    expect(phone.slots.size).toBe(0);
  });

  it.each(['identity.write', 'set:refreshToken', 'set:sessionMeta'])(
    'EVM-100 AC1: a commit that fails at %s ends the session of step 2 on the server and keeps no session token',
    async (write) => {
      phone.faults.set(write, 'fail');
      const rig = start(phone);
      expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
      expect(rig.client.calls).toEqual([`logout:${token('access-1')}`]);
      expect(phone.slots.has('refreshToken')).toBe(false);
      expect(phone.slots.has('sessionMeta')).toBe(false);
      expect(phone.slots.has('revocationToken')).toBe(false);
    },
  );

  it('EVM-100 AC1: a failed commit offline keeps the refresh token of step 2 only as a pending revocation', async () => {
    phone.faults.set('set:sessionMeta', 'fail');
    const rig = start(phone);
    rig.client.logoutScript.push(unavailable);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(pending()).toEqual([token('refresh-1')]);
    expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
  });
});

describe('start of the app (EVM-100 AC6)', () => {
  it('EVM-100 AC6: a signed-in user starts without any request (offline too) and gets an access token only through a refresh', async () => {
    await signedIn(phone);
    const rig = start(phone);
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_in' });
    expect(rig.client.calls).toEqual([]);
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    rig.client.refreshScript.push(unavailable);
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.currentUserId()).toBe(USER_A);
  });

  it('EVM-100 AC1: a partial state at start (record without token, token without record, unreadable record) is removed', async () => {
    for (const slots of [{ sessionMeta: '{"v":1}' }, { refreshToken: token('r') }, { refreshToken: token('r'), sessionMeta: 'not json' }]) {
      phone = newPhone();
      for (const [slot, value] of Object.entries(slots) as [never, string][]) phone.slots.set(slot, value);
      expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
      expect(phone.slots.has('refreshToken')).toBe(false);
      expect(phone.slots.has('sessionMeta')).toBe(false);
    }
  });

  it('EVM-100 AC1: a store that does not open at start goes to the device check; after "Rozumiem" the stored session is adopted', async () => {
    await signedIn(phone);
    phone.openAs = 'data_lost';
    const rig = start(phone);
    const step = await rig.owner.restore();
    if (step.kind !== 'device_check' || step.result.kind !== 'data_lost') throw new Error('expected data_lost');
    expect(await rig.owner.continueDeviceCheck(await step.result.acknowledge())).toEqual({ kind: 'signed_in' });
    expect(await rig.owner.currentUserId()).toBe(USER_A);
  });

  it('EVM-100 AC1: adopting at start needs a matching stored session; otherwise the store is locked again', async () => {
    const rig = start(phone);
    const opened = await rig.host.openForUser(USER_A);
    expect(await rig.owner.continueDeviceCheck(opened)).toEqual({ kind: 'signed_out' });
    expect(phone.log).toContain('lock');
  });

  it('EVM-100 AC1: an open that throws at start or at sign-in is an unavailable store (device check), not a crash', async () => {
    await signedIn(phone);
    const rig = start(phone, {});
    const throwing = { openForUser: () => Promise.reject(new Error('synthetic')) };
    const broken = new MobileSessionOwner({ client: rig.client, tokens: rig.tokens, host: throwing, wipe: rig.wipe, clock: rig.clock });
    expect(await broken.restore()).toEqual({ kind: 'device_check', result: { kind: 'unavailable', code: 'closed' } });
    expect(await broken.completeSignIn(issued())).toEqual({ kind: 'device_check', result: { kind: 'unavailable', code: 'closed' } });
  });
});

describe('refresh (EVM-100 AC5; architect 4, security W2)', () => {
  it('EVM-100 AC5: an expired access token and two parallel requests make ONE refresh; both get the rotated token, stored first', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    let release: () => void = () => undefined;
    rig.client.refreshScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve(ok(issued({ n: 2, withSecret: false })));
        };
      }),
    );
    const first = rig.owner.accessToken();
    const second = rig.owner.accessToken();
    release();
    expect(await Promise.all([first, second])).toEqual([token('access-2'), token('access-2')]);
    expect(rig.client.calls).toEqual([`refresh:${token('refresh-1')}`]);
    expect(phone.slots.get('refreshToken')).toBe(token('refresh-2'));
    expect(phone.log.slice(-2)).toEqual(['set:refreshToken', 'set:sessionMeta']);
  });

  it('EVM-100 AC5: a valid access token is used without a refresh', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(10 * 60_000);
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
    expect(rig.client.calls).toEqual([]);
  });

  it('EVM-100 AC5 (W2): a rotated token that cannot be stored is not used — no access token, the session stays', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    phone.faults.set('set:refreshToken', 'fail');
    expect(await rig.owner.refresh()).toBe('unavailable');
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    rig.client.refreshScript.push(unavailable);
    expect(await rig.owner.accessToken()).toBeNull();
  });

  it('EVM-100 AC5: a network error, 5xx, 429, 426 or 403 while refreshing signs nobody out; the next request retries', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    rig.client.refreshScript.push(
      unavailable,
      problem(429, 'too_many_requests'),
      problem(426, 'client_version_unsupported'),
      problem(403, 'forbidden'),
    );
    for (let n = 0; n < 4; n += 1) expect(await rig.owner.refresh()).toBe('unavailable');
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    expect(phone.slots.get('refreshToken')).toBe(token('refresh-1'));
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    expect(await rig.owner.accessToken()).toBe(token('access-2'));
  });

  it('EVM-100 AC5, AC4: 401 session_revoked while refreshing ends the session — N read first, then replica and tokens go, the queue stays', async () => {
    const rig = await signedIn(phone);
    phone.queue = 5;
    phone.replica = true;
    const events = ended(rig);
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(events).toEqual([{ reason: 'session_revoked', unsentItems: 5 }]);
    expect(phone.replica).toBe(false);
    expect(phone.queue).toBe(5);
    expect(phone.identity).not.toBeNull();
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(rig.client.calls).toHaveLength(1);
  });

  it('EVM-100 AC4, AC5: 401 device_wipe_required while refreshing removes tokens and record, locks the data and signals the wipe', async () => {
    const rig = await signedIn(phone);
    phone.queue = 3;
    const events = ended(rig);
    rig.client.refreshScript.push(problem(401, 'device_wipe_required'));
    expect(await rig.owner.refresh()).toBe('device_wipe_required');
    expect(rig.wipe.signals).toBe(1);
    expect(events).toEqual([{ reason: 'device_wipe_required', unsentItems: 0 }]);
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(phone.log).toContain('lock');
    expect(phone.log).not.toContain('endSession');
  });

  it('EVM-100 AC5: a missing refresh token (deleted elsewhere) ends the session; a failed read is unavailable', async () => {
    const rig = await signedIn(phone);
    phone.faults.set('get:refreshToken', 'fail');
    expect(await rig.owner.refresh()).toBe('unavailable');
    phone.slots.delete('refreshToken');
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(rig.client.calls).toEqual([]);
  });

  it('EVM-100 AC5: a refresh that throws is unavailable; a session not created by the adapter is not used', async () => {
    const rig = await signedIn(phone);
    rig.client.refresh = () => Promise.reject(new Error('synthetic'));
    expect(await rig.owner.refresh()).toBe('unavailable');
    rig.client.refresh = () => Promise.resolve(ok(Object.create(null) as never));
    expect(await rig.owner.refresh()).toBe('unavailable');
  });

  it('EVM-100 AC5: a session record that cannot be updated after a refresh does not lose the refresh', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    phone.faults.set('set:sessionMeta', 'fail');
    expect(await rig.owner.accessToken()).toBe(token('access-2'));
  });

  it('EVM-100 AC5 (architect 4): the sync gate and an app request meeting 401 at the same time share one refresh', async () => {
    const rig = await signedIn(phone);
    let release: () => void = () => undefined;
    rig.client.refreshScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve(ok(issued({ n: 2 })));
        };
      }),
    );
    const answers = [new Response(JSON.stringify({ code: 'unauthenticated' }), { status: 401 }), new Response('{}', { status: 200 })];
    const seen: string[] = [];
    const owner = new MobileSessionOwner({
      client: rig.client,
      tokens: rig.tokens,
      host: rig.host,
      wipe: rig.wipe,
      clock: rig.clock,
      fetch: (request) => {
        seen.push(request.headers.get('Authorization') ?? '');
        return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
      },
    });
    expect(await owner.restore()).toEqual({ kind: 'signed_in' });
    rig.client.refreshScript.unshift(ok(issued({ n: 9 })));
    expect(await owner.accessToken()).toBe(token('access-9'));
    const gate = new SessionGate(owner);
    const viaSync = gate.onHttpFailure(401, undefined, USER_A, true);
    const viaApp = owner.authorizedFetch('https://api.example.test/api/v1/x');
    await settle();
    release();
    expect(await viaSync).toBe('retry');
    expect((await viaApp)?.status).toBe(200);
    expect(rig.client.calls.filter((call) => call.startsWith('refresh:'))).toHaveLength(2);
    expect(seen).toEqual([`Bearer ${token('access-9')}`, `Bearer ${token('access-2')}`]);
  });

  it('EVM-100 AC5: device_wipe_required from the owner pauses the sync gate with the wipe', async () => {
    const rig = await signedIn(phone);
    rig.client.refreshScript.push(problem(401, 'device_wipe_required'));
    const gate = new SessionGate(rig.owner);
    expect(await gate.onHttpFailure(401, undefined, USER_A, true)).toBe('stop');
    expect(gate.paused).toBe('device_wipe_required');
  });
});

describe('"Sesja wygasła" or "Wylogowano ten telefon" (EVM-100 AC4, AC5; story decisions)', () => {
  it('EVM-100 AC5: more than 14 days without a successful contact → session_expired', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    rig.clock.advance(14 * DAY + 1);
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    await rig.owner.refresh();
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });

  it('EVM-100 AC5: a session older than 30 days → session_expired, even with refreshes in between', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    for (let n = 2; n <= 4; n += 1) {
      rig.clock.advance(10 * DAY);
      rig.client.refreshScript.push(ok(issued({ n, serverTime: T0 + (n - 1) * 10 * DAY })));
      expect(await rig.owner.refresh()).toBe('refreshed');
    }
    rig.clock.advance(1);
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    await rig.owner.refresh();
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });

  it('EVM-100 AC4: within the limits, or with the phone clock set back, the variant is "Wylogowano ten telefon"', async () => {
    let rig = await signedIn(phone);
    let events = ended(rig);
    rig.clock.advance(3 * DAY);
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    await rig.owner.refresh();
    expect(events.map((e) => e.reason)).toEqual(['session_revoked']);
    phone = newPhone();
    rig = await signedIn(phone);
    events = ended(rig);
    rig.clock.wall -= 40 * DAY;
    rig.clock.mono += 40 * DAY;
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    await rig.owner.refresh();
    expect(events.map((e) => e.reason)).toEqual(['session_revoked']);
  });

  it('EVM-100 AC4: after a restart the age is measured from the stored checkpoints (another boot)', async () => {
    await signedIn(phone);
    const clock = new FakeClock();
    clock.boot = 'boot-2';
    clock.mono = 5;
    clock.wall = T0 + 15 * DAY;
    const rig = start(phone, { clock });
    await rig.owner.restore();
    const events = ended(rig);
    rig.client.refreshScript.push(problem(401, 'session_revoked'));
    await rig.owner.refresh();
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });
});

describe('authorizedFetch (EVM-100 AC4, AC5)', () => {
  const rigWith = async (answers: Response[]) => {
    await signedIn(phone);
    const client = new FakeAuthClient();
    const seen: string[] = [];
    const rig = start(phone, {
      client,
      fetch: (request) => {
        seen.push(request.headers.get('Authorization') ?? '');
        return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
      },
    });
    await rig.owner.restore();
    client.refreshScript.push(ok(issued({ n: 2 })));
    return { rig, seen, client };
  };
  const problemResponse = (code: string) => new Response(JSON.stringify({ code }), { status: 401 });

  it('EVM-100 AC5: a plain 401 refreshes once and retries once with the new token', async () => {
    const { rig, seen, client } = await rigWith([new Response(null, { status: 401 }), new Response('{}', { status: 200 })]);
    client.refreshScript.push(ok(issued({ n: 3 })));
    expect((await rig.owner.authorizedFetch('https://api.example.test/x', { headers: { Accept: 'application/json' } }))?.status).toBe(200);
    expect(seen).toEqual([`Bearer ${token('access-2')}`, `Bearer ${token('access-3')}`]);
    expect(client.calls).toHaveLength(2);
  });

  it('EVM-100 AC4: 401 session_revoked and device_wipe_required from any request end the session without a refresh', async () => {
    const first = await rigWith([new Response('{}', { status: 200 }), problemResponse('session_revoked')]);
    const events = ended(first.rig);
    await first.rig.owner.authorizedFetch('https://api.example.test/x');
    expect((await first.rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(401);
    expect(events).toEqual([{ reason: 'session_revoked', unsentItems: 0 }]);
    phone = newPhone();
    const second = await rigWith([problemResponse('device_wipe_required')]);
    await second.rig.owner.authorizedFetch('https://api.example.test/x');
    expect(second.rig.wipe.signals).toBe(1);
    expect(await second.rig.owner.authorizedFetch('https://api.example.test/x')).toBeNull();
  });

  it('EVM-100 AC5: a failed refresh returns the 401 as it is; without a session nothing is sent', async () => {
    const { rig, client } = await rigWith([new Response('{}', { status: 200 }), new Response('[]', { status: 401 })]);
    await rig.owner.authorizedFetch('https://api.example.test/x');
    client.refreshScript.push(unavailable);
    expect((await rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(401);
    const empty = start(newPhone());
    expect(await empty.owner.authorizedFetch('https://api.example.test/x')).toBeNull();
  });

  it('EVM-100 AC5: the default fetch of the platform is used when none is injected', async () => {
    const rig = await signedIn(phone);
    const original = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    try {
      expect((await rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(200);
    } finally {
      global.fetch = original;
    }
  });
});

describe('sign-out and the pending revocation (EVM-100 AC7; architect 3, security W1)', () => {
  it('EVM-100 AC7: online with a valid access token — mobileLogout, then replica and tokens gone; the queue and identity stay', async () => {
    const rig = await signedIn(phone);
    phone.queue = 2;
    phone.replica = true;
    const events = ended(rig);
    expect(await rig.owner.signOut({ online: true })).toEqual({ reason: 'signed_out', unsentItems: 2 });
    expect(rig.client.calls).toEqual([`logout:${token('access-1')}`]);
    expect(events).toEqual([{ reason: 'signed_out', unsentItems: 2 }]);
    expect(phone.replica).toBe(false);
    expect(phone.queue).toBe(2);
    expect(phone.identity).not.toBeNull();
    expect([...phone.slots.keys()]).toEqual([]);
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.currentUserId()).toBeNull();
  });

  it('EVM-100 AC7 (W1a): offline the refresh token becomes the pending revocation — never a session again', async () => {
    const rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    expect(pending()).toEqual([token('refresh-1')]);
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(rig.client.calls).toEqual([]);
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.refresh()).toBe('session_revoked');
    const restarted = start(phone);
    expect(await restarted.owner.restore()).toEqual({ kind: 'signed_out' });
    expect(await restarted.owner.accessToken()).toBeNull();
  });

  it('EVM-100 AC7 (W1b): when the network returns — refresh, the rotated token stored in the slot BEFORE the logout, then the slot is removed', async () => {
    const rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    let slotAtLogout: string[] = [];
    rig.client.logout = (accessToken) => {
      rig.client.calls.push(`logout:${accessToken}`);
      slotAtLogout = pending();
      return Promise.resolve(ok(null));
    };
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([`refresh:${token('refresh-1')}`, `logout:${token('access-2')}`]);
    expect(slotAtLogout).toEqual([token('refresh-2')]);
    expect(phone.slots.has('revocationToken')).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
  });

  it('EVM-100 AC7 (W1c): 401/403 at refresh or logout remove the slot; network, 5xx, 429 and 426 keep it for the next connection', async () => {
    const rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    for (const answer of [unavailable, problem(429, 'too_many_requests'), problem(426, 'client_version_unsupported')]) {
      rig.client.refreshScript.push(answer);
      await rig.owner.flushPendingRevocation();
      expect(pending()).toEqual([token('refresh-1')]);
    }
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    rig.client.logoutScript.push(unavailable);
    await rig.owner.flushPendingRevocation();
    expect(pending()).toEqual([token('refresh-2')]);
    rig.client.refreshScript.push(ok(issued({ n: 3 })));
    rig.client.logoutScript.push(problem(401, 'session_revoked'));
    await rig.owner.flushPendingRevocation();
    expect(phone.slots.has('revocationToken')).toBe(false);
    for (const answer of [problem(401, 'session_revoked'), problem(401, 'device_wipe_required'), problem(403, 'forbidden')]) {
      phone.slots.set('revocationToken', JSON.stringify([token('old')]));
      rig.client.refreshScript.push(answer);
      await rig.owner.flushPendingRevocation();
      expect(phone.slots.has('revocationToken')).toBe(false);
    }
  });

  it('EVM-100 AC7: online without a valid access token the sign-out ends the server session through the revocation path', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    rig.client.refreshScript.push(ok(issued({ n: 2 })));
    await rig.owner.signOut({ online: true });
    expect(rig.client.calls).toEqual([`refresh:${token('refresh-1')}`, `logout:${token('access-2')}`]);
    expect(phone.slots.has('revocationToken')).toBe(false);
  });

  it('EVM-100 AC7: an online logout that fails on the network keeps the pending revocation; a 401 at logout drops it', async () => {
    let rig = await signedIn(phone);
    rig.client.logoutScript.push(unavailable);
    await rig.owner.signOut({ online: true });
    expect(pending()).toEqual([token('refresh-1')]);
    phone = newPhone();
    rig = await signedIn(phone);
    rig.client.logoutScript.push(problem(401, 'session_revoked'));
    await rig.owner.signOut({ online: true });
    expect(phone.slots.has('revocationToken')).toBe(false);
  });

  it('EVM-100 AC7 (W1f): the sign-out waits for a running refresh and keeps the NEWEST token as the pending revocation', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    let release: () => void = () => undefined;
    rig.client.refreshScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve(ok(issued({ n: 2 })));
        };
      }),
    );
    const refreshing = rig.owner.refresh();
    const signingOut = rig.owner.signOut({ online: false });
    release();
    expect(await refreshing).toBe('refreshed');
    await signingOut;
    expect(pending()).toEqual([token('refresh-2')]);
  });

  it('EVM-100 AC7 (W1d): a new sign-in of the same installation drops the pending revocation WITHOUT sending it', async () => {
    let rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    rig = start(phone);
    expect(await rig.owner.completeSignIn(issued({ n: 2 }))).toEqual({ kind: 'signed_in' });
    expect(phone.slots.has('revocationToken')).toBe(false);
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([]);
  });

  it('EVM-100 AC7: a sign-in that registered ANOTHER device keeps the pending revocation and sends it afterwards', async () => {
    let rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    phone.identity = null;
    rig = start(phone);
    expect(await rig.owner.completeSignIn(issued({ n: 2, deviceId: DEVICE_2 }))).toEqual({ kind: 'signed_in' });
    expect(pending()).toEqual([token('refresh-1')]);
    rig.client.refreshScript.push(ok(issued({ n: 3 })));
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([`refresh:${token('refresh-1')}`, `logout:${token('access-3')}`]);
    expect(await rig.owner.accessToken()).toBe(token('access-2'));
    expect(phone.slots.get('refreshToken')).toBe(token('refresh-2'));
  });

  it('EVM-100 AC7 (W1d): no revocation is sent while a session of step 2 waits for the device check', async () => {
    let rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    phone.openAs = 'unavailable';
    rig = start(phone);
    await rig.owner.completeSignIn(issued({ n: 2 }));
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([]);
    await rig.owner.abandonSignIn();
    rig.client.refreshScript.push(unavailable);
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([`logout:${token('access-2')}`, `refresh:${token('refresh-1')}`]);
  });

  it('EVM-100 AC7 (W1d): the HTTP calls of the sign-in steps are serialised with the revocation', async () => {
    const rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    const order: string[] = [];
    let release: () => void = () => undefined;
    rig.client.refresh = () => {
      order.push('refresh');
      return new Promise((resolve) => {
        release = () => {
          resolve(unavailable);
        };
      });
    };
    const flushing = rig.owner.flushPendingRevocation();
    const signIn = rig.owner.signInClient();
    const step1 = signIn.login({ email: 'a@example.test', password: 'p' }).then((result) => {
      order.push('login');
      return result;
    });
    await settle();
    release();
    await flushing;
    expect((await step1).kind).toBe('ok');
    const challenge = await signIn.login({ email: 'a@example.test', password: 'p' });
    if (challenge.kind !== 'ok') throw new Error('expected a challenge');
    expect((await signIn.loginTotp(challenge.value, '123456')).kind).toBe('ok');
    expect(order).toEqual(['refresh', 'login']);
  });

  it('EVM-100 AC7: a sign-out interrupted after the pending revocation was stored is finished at the next start', async () => {
    const rig = await signedIn(phone);
    phone.replica = true;
    phone.faults.set('set:revocationToken', 'crash');
    await rig.owner.signOut({ online: false }).catch(() => undefined);
    phone.dead = false;
    expect(phone.slots.get('refreshToken')).toBe(token('refresh-1'));
    expect(pending()).toEqual([token('refresh-1')]);
    const restarted = start(phone);
    expect(await restarted.owner.restore()).toEqual({ kind: 'signed_out' });
    expect(phone.replica).toBe(false);
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(pending()).toEqual([token('refresh-1')]);
  });

  it('EVM-100 AC7: several offline sign-outs keep the newest pending revocations (at most four) and send all of them', async () => {
    for (let n = 1; n <= 5; n += 1) {
      const rig = await signedIn(phone, n);
      await rig.owner.signOut({ online: false });
      phone.identity = null;
    }
    expect(pending()).toEqual([2, 3, 4, 5].map((n) => token(`refresh-${String(n)}`)));
    const rig = start(phone);
    for (let n = 6; n <= 9; n += 1) rig.client.refreshScript.push(ok(issued({ n })));
    await rig.owner.flushPendingRevocation();
    expect(phone.slots.has('revocationToken')).toBe(false);
    expect(rig.client.calls.filter((call) => call.startsWith('logout:'))).toHaveLength(4);
  });

  it('EVM-100 AC7: an unreadable pending slot is treated as empty; a session not issued by the adapter stops the flush', async () => {
    phone.slots.set('revocationToken', 'not json');
    const rig = start(phone);
    await rig.owner.flushPendingRevocation();
    phone.slots.set('revocationToken', '{"a":1}');
    await rig.owner.flushPendingRevocation();
    expect(rig.client.calls).toEqual([]);
    phone.slots.set('revocationToken', JSON.stringify([token('x')]));
    rig.client.refresh = () => Promise.resolve(ok(Object.create(null) as never));
    await rig.owner.flushPendingRevocation();
    expect(pending()).toEqual([token('x')]);
  });

  it('EVM-100 AC7: signing out without a session asks nothing and ends nothing twice', async () => {
    const rig = start(phone);
    expect(await rig.owner.signOut({ online: true })).toEqual({ reason: 'signed_out', unsentItems: 0 });
    expect(rig.client.calls).toEqual([]);
    expect(phone.slots.has('revocationToken')).toBe(false);
  });

  it('EVM-100 AC7: a listener that throws does not break the end of the session; unsubscribing stops the events', async () => {
    const rig = await signedIn(phone);
    const seen: string[] = [];
    rig.owner.onSessionEnded(() => {
      throw new Error('synthetic');
    });
    const unsubscribe = rig.owner.onSessionEnded((e) => seen.push(e.reason));
    unsubscribe();
    expect((await rig.owner.signOut({ online: false })).reason).toBe('signed_out');
    expect(seen).toEqual([]);
    expect(rig.owner.displayName()).toBeNull();
  });
});
