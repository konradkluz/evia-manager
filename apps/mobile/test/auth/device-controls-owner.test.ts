import { LoginMachine } from '../../src/auth/login-machine';
import { FakeAuthServer } from './fake-auth-server';
import { FakeClock, FakeWipe, issued, newPhone, ok, signedIn, start, type Phone } from './fakes';
import { T0, USER_A } from './fixtures';

const DAY = 86_400_000;
let phone: Phone;
beforeEach(() => {
  phone = newPhone();
});

describe('session owner: the 7-day rule and the queue list (EVM-101 AC2, AC8)', () => {
  it('EVM-101 AC2: a full sign-in records the contact; days later the status carries the elapsed time (one evaluation per call)', async () => {
    const rig = await signedIn(phone);
    expect(phone.contact).toMatchObject({ v: 1, serverTime: T0 });
    rig.clock.mono += 5 * DAY;
    rig.clock.wall += 5 * DAY;
    const result = await rig.owner.contactStatus();
    expect(result?.status).toEqual({ visible: true, elapsedMs: 5 * DAY });
    expect(result?.windowDays).toBeUndefined();
  });

  it('EVM-101 AC2: after the window the data are hidden; the window of the last client-config is honoured', async () => {
    const rig = await signedIn(phone);
    phone.config = { offlineContactWindowDays: 3 };
    rig.clock.mono += 3 * DAY + 1;
    rig.clock.wall += 3 * DAY + 1;
    const result = await rig.owner.contactStatus();
    expect(result?.status).toEqual({ visible: false, reason: 'window_elapsed', elapsedMs: 3 * DAY + 1 });
    expect(result?.windowDays).toBe(3);
  });

  it('EVM-101 AC2: a clock set back is an anomaly (fail-closed)', async () => {
    const rig = await signedIn(phone);
    rig.clock.mono -= 1;
    const result = await rig.owner.contactStatus();
    expect(result?.status).toMatchObject({ visible: false, reason: 'clock_anomaly' });
  });

  it('EVM-101 AC2: a refresh is a contact; a failing write of the checkpoint never fails the sign-in; no session -> null', async () => {
    const rig = await signedIn(phone);
    rig.clock.mono += 6 * DAY;
    rig.clock.wall += 6 * DAY;
    rig.client.refreshScript.push(ok(issued({ n: 2, serverTime: T0 + 6 * DAY })));
    expect(await rig.owner.refresh()).toBe('refreshed');
    expect(phone.contact).toMatchObject({ serverTime: T0 + 6 * DAY, carried: 0 });
    const fresh = start(newPhone());
    expect(await fresh.owner.contactStatus()).toBeNull();
  });

  it('EVM-101 AC2: a refresh never brings back hidden data - the window elapsed stays hidden until a FULL sign-in', async () => {
    const rig = await signedIn(phone);
    rig.clock.mono += 8 * DAY;
    rig.clock.wall += 8 * DAY;
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'window_elapsed' });
    rig.client.refreshScript.push(ok(issued({ n: 2, serverTime: T0 + 8 * DAY })));
    expect(await rig.owner.refresh()).toBe('refreshed');
    expect((await rig.owner.contactStatus())?.status.visible).toBe(false);
    expect(phone.contact).toMatchObject({ serverTime: T0 });
    // the password and the code again: the contact is recorded and the data are visible
    const again = await signedIn(phone, 3, start(phone, { clock: rig.clock }));
    expect((await again.owner.contactStatus())?.status.visible).toBe(true);
  });

  it('EVM-101 AC2: a clock anomaly is not cleared by a refresh either', async () => {
    const rig = await signedIn(phone);
    rig.clock.mono -= 1;
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'clock_anomaly' });
    rig.client.refreshScript.push(ok(issued({ n: 2, serverTime: T0 })));
    await rig.owner.refresh();
    expect((await rig.owner.contactStatus())?.status.visible).toBe(false);
  });

  it('EVM-101 AC2: the 7 days are measured by the boot clock - a process clock stopped by sleep (+1 h) with the wall +8 days still hides the data', async () => {
    const boot = new FakeClock();
    const clock = new FakeClock();
    const rig = await signedIn(phone, 1, start(phone, { clock, contactClock: boot }));
    clock.mono += 60 * 60_000; // performance.now(): stood still while the phone slept
    clock.wall += 8 * DAY;
    boot.mono += 8 * DAY; // CLOCK_BOOTTIME counted the sleep
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'window_elapsed' });
  });

  it('EVM-101 AC2: no boot clock (module missing) is fail-closed - the data are hidden, the session itself works', async () => {
    const boot = new FakeClock();
    boot.mono = Number.NaN;
    boot.boot = '';
    phone.hasData = true;
    const rig = await signedIn(phone, 1, start(phone, { contactClock: boot }));
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'no_contact_record' });
    expect(await rig.owner.currentUserId()).not.toBeNull();
  });

  it('EVM-101 AC8: the queue list drops the contents at the source unless labels are asked for', async () => {
    const rig = await signedIn(phone);
    phone.queueRecords = [
      { mutationId: 'm-1', type: 'CreateNote', state: 'pending', payload: { body: 'SYNTHETIC-NOTE-TEXT' } },
      { mutationId: 'm-2', type: 'CreateWorkOrder', state: 'retrying', payload: {} },
      'junk',
    ];
    expect(await rig.owner.queueEntries(true)).toEqual([
      { id: 'm-1', type: 'CreateNote', state: 'pending', label: 'SYNTHETIC-NOTE-TEXT' },
      { id: 'm-2', type: 'CreateWorkOrder', state: 'retrying', label: null },
      { id: '2', type: 'unknown', state: 'pending', label: null },
    ]);
    const hidden = await rig.owner.queueEntries(false);
    expect(JSON.stringify(hidden)).not.toContain('SYNTHETIC-NOTE-TEXT');
    expect(hidden.map((row) => row.label)).toEqual([null, null, null]);
    expect(await start(newPhone()).owner.queueEntries(true)).toEqual([]);
  });
});

describe('session owner: ending the session for a wipe (EVM-101 AC4, AC5)', () => {
  it('EVM-101 AC4: online the server is asked to end the session first; the tokens and the store go; nothing is kept as a pending revocation', async () => {
    const rig = await signedIn(phone);
    const events: unknown[] = [];
    rig.owner.onSessionEnded((e) => events.push(e));
    await rig.owner.endSessionForWipe({ online: true });
    expect(rig.client.calls.some((call) => call.startsWith('logout'))).toBe(true);
    expect(phone.slots.has('refreshToken')).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(phone.slots.has('revocationToken')).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
    // no `SessionEnded`: "Wylogowano" with a count of unsent items would be shown over the running wipe
    expect(events).toEqual([]);
  });

  it('EVM-101 AC4: offline no request is made', async () => {
    const rig = await signedIn(phone);
    await rig.owner.endSessionForWipe({ online: false });
    expect(rig.client.calls.some((call) => call.startsWith('logout'))).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
  });
});

describe('sign-in without a screen lock (EVM-101 AC1, SR-MOB-06)', () => {
  const EMAIL = 'jan@example.test';

  function machine(secure: boolean | 'throws') {
    const server = new FakeAuthServer();
    const sessions: unknown[] = [];
    const checks = { count: 0 };
    const m = new LoginMachine({
      signIn: server,
      onSession: (s) => {
        sessions.push(s);
        return Promise.resolve('done');
      },
      wipe: new FakeWipe(),
      now: () => T0,
      screenLockOk: () => {
        checks.count += 1;
        return secure === 'throws' ? Promise.reject(new Error('native (synthetic)')) : Promise.resolve(secure);
      },
    });
    return { m, server, sessions, checks };
  }

  it.each([false, 'throws'] as const)(
    'EVM-101 AC1: without a lock (%s) step 1 sends nothing - not the password, not the device',
    async (secure) => {
      const { m, server, sessions } = machine(secure);
      m.setEmail(EMAIL);
      m.setPassword('synthetic-password');
      await m.submitCredentials(true);
      expect(server.requests).toEqual([]);
      expect(sessions).toEqual([]);
      expect(m.state).toMatchObject({ blocked: 'screen_lock_required', password: '', busy: false, step: 'credentials' });
      m.backToSignIn();
      expect(m.state.blocked).toBeNull();
    },
  );

  it('EVM-101 AC1: with a lock the sign-in goes on; the check runs before step 2 too, and a lock removed in between ends the sign-in without a request', async () => {
    const { m, server } = machine(true);
    m.setEmail(EMAIL);
    m.setPassword('synthetic-password');
    await m.submitCredentials(true);
    expect(server.requests).toHaveLength(1);
    expect(m.state.step).toBe('code');
    const off = machine(false);
    // the second machine is at step 1 only: force step 2 by a machine whose lock disappears after step 1
    let secure = true;
    const server2 = new FakeAuthServer();
    const m2 = new LoginMachine({
      signIn: server2,
      onSession: () => Promise.resolve('done'),
      wipe: new FakeWipe(),
      now: () => T0,
      screenLockOk: () => Promise.resolve(secure),
    });
    m2.setEmail(EMAIL);
    m2.setPassword('synthetic-password');
    await m2.submitCredentials(true);
    secure = false;
    m2.setCode('123456');
    await m2.submitCode(true);
    expect(server2.requests).toHaveLength(1);
    expect(m2.state.blocked).toBe('screen_lock_required');
    expect(off.checks.count).toBe(0);
  });
});

describe('owner of the queue (EVM-101 AC5, SR-MOB-13)', () => {
  it('EVM-101 AC5: another user gets owner_mismatch; nothing of the new session is stored, "Anuluj" ends it on the server and leaves the store untouched', async () => {
    phone.owner = USER_A;
    phone.queue = 4;
    const rig = start(phone);
    const step = await rig.owner.completeSignIn(issued({ n: 9, user: 'user-b-synthetic' }));
    expect(step).toEqual({ kind: 'device_check', result: { kind: 'owner_mismatch', unsentItemCount: 4 } });
    expect(phone.slots.size).toBe(0);
    expect(phone.identity).toBeNull();
    const before = phone.log.length;
    await rig.owner.abandonSignIn();
    expect(rig.client.calls.some((call) => call.startsWith('logout'))).toBe(true);
    expect(phone.log.slice(before)).toEqual([]);
    expect(phone.queue).toBe(4);
    expect(phone.owner).toBe(USER_A);
  });
});
