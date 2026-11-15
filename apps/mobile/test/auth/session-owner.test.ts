// The JavaScript session owner is a thin adapter over the native owner of the tokens (EVM-130, ADR-0020a). The scenarios of the TOKEN
// itself (single flight, a rotated token stored first, the window of a lost answer, the pending revocations, the file format) are tested
// in Kotlin (`engine/src/test`, see `.scratch/EVM-130/tabela-js-jvm.md`); here the adapter is proved against a scripted module: what it
// hands over and when, how it reacts to the answers and states of the module, and what stays on the JavaScript side (identity, record,
// device check, the contact rule, the events for the screens).
import { SessionGate } from '@evia/sync-core';
import type { SessionEnded } from '../../src/auth/ports';
import { MobileSessionOwner } from '../../src/auth/session-owner';
import { DEVICE_1, DEVICE_2, T0, USER_A, USER_B, secret, token } from './fixtures';
import { FakeAuthClient, FakeClock, issued, newPhone, signedIn, start, type Phone } from './fakes';

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
const natives = (): string[] => phone.native.calls;

describe('sign-in commit (EVM-100 AC1; EVM-130 AC3; architect 1, security A2)', () => {
  it('EVM-130 AC3: after step 2 the tokens go to the module ONCE (staged); then the store is opened, identity → native commit → session record; the access token stays in memory', async () => {
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'signed_in' });
    expect(rig.host.opened).toEqual([USER_A]);
    expect(phone.log).toEqual([
      'native.stageLogin',
      'identity.write',
      'native.commitStaged:other',
      'set:sessionMeta',
      'native.clearWipeMarkerAfterLogin',
      'saveContact',
    ]);
    expect(phone.native.received).toEqual([{ refreshToken: token('refresh-1'), accessToken: token('access-1') }]);
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(1) });
    const stored = [...phone.slots.values()].join('|');
    expect(stored).not.toContain(token('access-1'));
    expect(stored).not.toContain(token('refresh-1'));
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

  it('EVM-130 AC3: a carrier of a session gives its tokens up once — the same session cannot be handed over twice', async () => {
    const session = issued();
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(session)).toEqual({ kind: 'signed_in' });
    expect(await start(newPhone()).owner.completeSignIn(session)).toEqual({ kind: 'failed' });
    expect(phone.native.received).toHaveLength(1);
  });

  it('EVM-130 AC3: no log line, error or return value of the owner carries a token (the owner holds none after the hand-over)', async () => {
    const rig = start(phone);
    const step = await rig.owner.completeSignIn(issued());
    const everything = JSON.stringify([step, phone.log, natives(), [...phone.slots.entries()], await rig.owner.contactStatus()]);
    expect(everything).not.toContain(token('refresh-1'));
    expect(everything).not.toContain(token('access-1'));
  });

  it.each(['owner_mismatch', 'data_lost', 'unavailable', 'update_required', 'wipe_incomplete'] as const)(
    'EVM-100 AC1: an open result %s stages the session in the module, stores nothing in JavaScript and commits nothing — it goes to the device check',
    async (kind) => {
      if (kind === 'owner_mismatch') phone.owner = USER_B;
      else phone.openAs = kind;
      const rig = start(phone);
      const step = await rig.owner.completeSignIn(issued());
      expect(step.kind).toBe('device_check');
      if (step.kind === 'device_check') expect(step.result.kind).toBe(kind);
      expect(natives()).toEqual(['stageLogin']);
      expect(phone.log).toEqual(['native.stageLogin']);
      expect(phone.slots.size).toBe(0);
      expect(await rig.owner.currentUserId()).toBeNull();
      expect(await rig.owner.accessToken()).toBeNull();
      expect(rig.client.calls).toEqual([]);
      await rig.owner.abandonSignIn();
      expect(natives()).toEqual(['stageLogin', 'abandonStaged']);
      expect(phone.slots.size).toBe(0);
      expect(await rig.owner.continueDeviceCheck({ kind: 'wipe_incomplete' })).toEqual({
        kind: 'device_check',
        result: { kind: 'wipe_incomplete' },
      });
    },
  );

  it('EVM-100 AC1: after data_lost and "Rozumiem" the identity of step 2 is written into the NEW store only, then the staged session is committed', async () => {
    phone.identity = { deviceId: DEVICE_2, secret: secret(9) };
    phone.openAs = 'data_lost';
    const rig = start(phone);
    const step = await rig.owner.completeSignIn(issued());
    if (step.kind !== 'device_check' || step.result.kind !== 'data_lost') throw new Error('expected data_lost');
    expect(phone.log).toEqual(['native.stageLogin']);
    const reopened = await step.result.acknowledge();
    expect(await rig.owner.continueDeviceCheck(reopened)).toEqual({ kind: 'signed_in' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(1) });
    expect(phone.log.slice(0, 4)).toEqual(['native.stageLogin', 'identity.write', 'native.commitStaged:other', 'set:sessionMeta']);
  });

  it('EVM-100 AC1 (SR-MOB-13): a store unlocked for another user than the session of step 2 is not used; the staged session is abandoned', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    phone.openAs = null;
    const other = await rig.host.openForUser(USER_B);
    expect(await rig.owner.continueDeviceCheck(other)).toEqual({ kind: 'failed' });
    expect(natives()).toEqual(['stageLogin', 'abandonStaged']);
    expect(phone.slots.size).toBe(0);
  });

  it('EVM-100 AC1 (RR-69): when the new secret cannot be stored the sign-in fails, the old secret stays and the staged session is abandoned', async () => {
    phone.identity = { deviceId: DEVICE_1, secret: secret(0) };
    phone.faults.set('identity.write', 'fail');
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(0) });
    expect(phone.slots.size).toBe(0);
    expect(phone.log).toEqual(['native.stageLogin', 'lock', 'native.abandonStaged']);
  });

  it.each(['storage_failed', 'unavailable', 'nothing_staged'] as const)(
    'EVM-130 AC3: a commit the module answers %s fails the sign-in visibly; the record is not written and the store is locked',
    async (answer) => {
      phone.native.commitResult = answer;
      const rig = start(phone);
      expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
      expect(phone.slots.size).toBe(0);
      expect(phone.log).toContain('lock');
      expect(await rig.owner.currentUserId()).toBeNull();
    },
  );

  it.each(['invalid', 'unavailable'] as const)(
    'EVM-130 AC3: a module that does not take the session (%s) is a failed sign-in with nothing stored — JavaScript never keeps a token itself',
    async (answer) => {
      phone.native.stageResult = answer;
      const rig = start(phone);
      expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
      expect(rig.host.opened).toEqual([]);
      expect(phone.slots.size).toBe(0);
      expect(phone.identity).toBeNull();
    },
  );

  it('EVM-100 AC1: a session record that cannot be stored ends the committed session in the module and leaves no session behind', async () => {
    phone.faults.set('set:sessionMeta', 'fail');
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued())).toEqual({ kind: 'failed' });
    expect(natives()).toEqual(['stageLogin', 'commitStaged:other', 'signOut:online']);
    expect(phone.native.session.state).toBe('signed_out');
    expect(phone.slots.has('sessionMeta')).toBe(false);
  });

  it('EVM-100 AC7 (W1d): the same installation (the stored identity has the device of the new session) is told to the module, another one is not', async () => {
    phone.identity = { deviceId: DEVICE_1, secret: secret(0) };
    await start(phone).owner.completeSignIn(issued({ n: 2 }));
    expect(natives()).toContain('commitStaged:same');
    phone = newPhone();
    phone.identity = { deviceId: DEVICE_2, secret: secret(0) };
    await start(phone).owner.completeSignIn(issued({ n: 2 }));
    expect(natives()).toContain('commitStaged:other');
  });

  it('EVM-100 AC1: a session without a new secret keeps the stored identity; a session not issued by the adapter is refused before anything is handed over', async () => {
    phone.identity = { deviceId: DEVICE_1, secret: secret(0) };
    const rig = start(phone);
    expect(await rig.owner.completeSignIn(issued({ withSecret: false }))).toEqual({ kind: 'signed_in' });
    expect(phone.identity).toEqual({ deviceId: DEVICE_1, secret: secret(0) });
    const other = newPhone();
    expect(await start(other).owner.completeSignIn(Object.create(null) as never)).toEqual({ kind: 'failed' });
    expect(other.native.calls).toEqual([]);
  });

  it('EVM-100 AC1: a process killed between the writes of the sign-in restarts with no session or with the whole one, never half', async () => {
    for (const write of ['identity.write', 'set:sessionMeta']) {
      phone = newPhone();
      phone.faults.set(write, 'crash');
      await start(phone)
        .owner.completeSignIn(issued())
        .catch(() => undefined);
      phone.dead = false;
      // the staged session lived in the memory of the dead process only
      if (write === 'identity.write') phone.native.staged = null;
      const restarted = start(phone);
      const step = await restarted.owner.restore();
      if (step.kind === 'signed_in') {
        // the crash came after the record was written: the whole session is there, on both sides
        expect(phone.slots.has('sessionMeta') && phone.native.session.state === 'signed_in').toBe(true);
      } else {
        expect(step).toEqual({ kind: 'signed_out' });
        expect(phone.slots.has('sessionMeta')).toBe(false);
        expect(phone.native.session.state).toBe('signed_out');
        expect(await restarted.owner.currentUserId()).toBeNull();
      }
      expect(restarted.client.calls).toEqual([]);
    }
  });

  it('EVM-100 AC1: a session that was committed natively but has no record (the process died in between) is ended at the next start, its replica removed', async () => {
    await signedIn(phone);
    // the process died after the native commit and before the record: the record is simply not there
    phone.slots.delete('sessionMeta');
    phone.replica = true;
    expect(phone.native.session.state).toBe('signed_in');
    expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
    expect(phone.native.session.state).toBe('signed_out');
    expect(natives()).toContain('signOut:offline');
    expect(phone.replica).toBe(false);
  });

  it('EVM-130 AC3: the process died after the native sign-out, before the replica was removed — the next start finishes the sign-out (replica removed)', async () => {
    await signedIn(phone);
    const rig = start(phone);
    await rig.owner.restore();
    phone.replica = true;
    // the sign-out was confirmed (the marker is stored first), the module signed out, the process died before `endSession`
    const stored = JSON.parse(phone.slots.get('sessionMeta') ?? '{}') as Record<string, unknown>;
    phone.slots.set('sessionMeta', JSON.stringify({ ...stored, ending: true }));
    phone.native.session = { state: 'signed_out', ownerId: null };
    expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
    expect(phone.replica).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
  });

  it('EVM-130 AC3: the sign-out stores its confirmation before the module is asked', async () => {
    await signedIn(phone);
    const rig = start(phone);
    await rig.owner.restore();
    phone.native.calls.length = 0;
    let markerAtSignOut: unknown;
    const original = rig.native.signOut.bind(rig.native);
    rig.native.signOut = (online) => {
      markerAtSignOut = (JSON.parse(phone.slots.get('sessionMeta') ?? '{}') as Record<string, unknown>)['ending'];
      return original(online);
    };
    await rig.owner.signOut({ online: false });
    expect(markerAtSignOut).toBe(true);
    expect(phone.slots.has('sessionMeta')).toBe(false);
  });
});

describe('a session of step 2 that is not kept is ended (EVM-100 AC1; code review: device limit, RR-72)', () => {
  it('EVM-100 AC1: abandoning the device check abandons the staged session once; nothing is stored in JavaScript', async () => {
    phone.owner = USER_B;
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    await rig.owner.abandonSignIn();
    expect(natives()).toEqual(['stageLogin', 'abandonStaged']);
    expect(phone.slots.size).toBe(0);
    await rig.owner.abandonSignIn();
    expect(natives().filter((call) => call === 'abandonStaged')).toHaveLength(1);
  });

  it('EVM-100 AC1: abandoning without a session of step 2 asks the module nothing', async () => {
    const rig = start(phone);
    await rig.owner.abandonSignIn();
    expect(natives()).toEqual([]);
    expect(phone.slots.size).toBe(0);
  });

  it('EVM-100 AC1: a module call that throws never breaks the abandon (the module keeps its own pending revocation)', async () => {
    phone.openAs = 'unavailable';
    const rig = start(phone);
    await rig.owner.completeSignIn(issued());
    rig.native.abandonStaged = () => Promise.reject(new Error('boom'));
    await expect(rig.owner.abandonSignIn()).resolves.toBeUndefined();
  });
});

describe('start of the app (EVM-100 AC6; EVM-130 AC3)', () => {
  it('EVM-100 AC6: a signed-in user starts without any request (offline too) and gets an access token only from the module', async () => {
    await signedIn(phone);
    const rig = start(phone);
    phone.native.calls.length = 0;
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_in' });
    expect(rig.client.calls).toEqual([]);
    expect(natives()).toEqual(['sessionState', 'lastContact']);
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    phone.native.accessScript.push({ status: 'retry_later' });
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
  });

  it('EVM-130 AC3: after an update the module has no session: the record goes, the user signs in once more — the queue, the identity and the replica stay', async () => {
    phone.slots.set('sessionMeta', await metaOf());
    phone.queue = 7;
    phone.replica = true;
    phone.identity = { deviceId: DEVICE_1, secret: secret(1) };
    phone.owner = USER_A;
    const rig = start(phone);
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_out' });
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(phone.queue).toBe(7);
    expect(phone.replica).toBe(true);
    expect(phone.identity).not.toBeNull();
    expect(phone.log).not.toContain('endSession');
    expect(natives()).toEqual(['sessionState']);
    expect(await rig.owner.currentUserId()).toBeNull();
  });

  async function metaOf(): Promise<string> {
    const probe = newPhone();
    await signedIn(probe);
    return probe.slots.get('sessionMeta') ?? '';
  }

  it('EVM-100 AC1: an unreadable or missing record at start is a signed-out start; a record of another user than the native session is ended', async () => {
    for (const text of [null, 'not json', '{"v":1}']) {
      phone = newPhone();
      if (text !== null) phone.slots.set('sessionMeta', text);
      expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
      expect(phone.slots.has('sessionMeta')).toBe(false);
    }
    phone = newPhone();
    await signedIn(phone);
    phone.native.session = { state: 'signed_in', ownerId: `${USER_B}:${DEVICE_1}` };
    expect(await start(phone).owner.restore()).toEqual({ kind: 'signed_out' });
    expect(phone.native.session.state).toBe('signed_out');
    expect(phone.slots.has('sessionMeta')).toBe(false);
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
    const broken = new MobileSessionOwner({
      client: rig.client,
      tokens: rig.tokens,
      native: rig.native,
      host: throwing,
      wipe: rig.wipe,
      clock: rig.clock,
    });
    expect(await broken.restore()).toEqual({ kind: 'device_check', result: { kind: 'unavailable', code: 'closed' } });
    expect(await broken.completeSignIn(issued())).toEqual({ kind: 'device_check', result: { kind: 'unavailable', code: 'closed' } });
  });

  it('EVM-130 AC5: a session the module paused while the app was dead (paused_revoked) is adopted and then ended by the reconcile — "Wylogowano ten telefon", the queue stays', async () => {
    await signedIn(phone);
    phone.queue = 5;
    phone.replica = true;
    phone.native.session = { state: 'paused_revoked', ownerId: `${USER_A}:${DEVICE_1}` };
    const rig = start(phone);
    const events = ended(rig);
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_in' });
    await rig.owner.reconcileNative();
    expect(events).toEqual([{ reason: 'session_revoked', unsentItems: 5 }]);
    expect(phone.replica).toBe(false);
    expect(phone.queue).toBe(5);
    expect(phone.slots.has('sessionMeta')).toBe(false);
  });

  it('EVM-130 AC5: a wipe order the module met while the app was dead starts the wipe at start; 426 (paused_update) keeps the session and shows the update', async () => {
    await signedIn(phone);
    phone.native.session = { state: 'wipe_required', ownerId: null };
    const rig = start(phone);
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_out' });
    expect(rig.wipe.signals).toBe(1);
    expect(phone.slots.has('sessionMeta')).toBe(false);

    phone = newPhone();
    await signedIn(phone);
    phone.native.session = { state: 'paused_update', ownerId: `${USER_A}:${DEVICE_1}` };
    const second = start(phone);
    const seen: string[] = [];
    second.owner.onUpdateRequired(() => seen.push('update'));
    expect(await second.owner.restore()).toEqual({ kind: 'signed_in' });
    await second.owner.reconcileNative();
    expect(seen).toEqual(['update']);
    expect(await second.owner.currentUserId()).toBe(USER_A);
  });

  it('EVM-130 AC5: a reconcile of a healthy or unavailable module changes nothing; without a session it does nothing', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    await rig.owner.reconcileNative();
    phone.native.session = { state: 'unavailable', ownerId: null };
    await rig.owner.reconcileNative();
    expect(events).toEqual([]);
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    await start(newPhone()).owner.reconcileNative();
  });
});

describe('the access token comes from the module (EVM-130 AC2; EVM-100 AC5; architect 4)', () => {
  it('EVM-130 AC2: an expired access token and two parallel requests make ONE request to the module; both get the new token', async () => {
    const rig = await signedIn(phone);
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
    phone.native.rejected.length = 0;
    phone.native.calls.length = 0;
    rig.clock.advance(15 * 60_000);
    let release: () => void = () => undefined;
    phone.native.accessScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve({ status: 'ready', accessToken: token('access-2'), ownerId: `${USER_A}:${DEVICE_1}`, validForMs: 15 * 60_000 });
        };
      }),
    );
    const first = rig.owner.accessToken();
    const second = rig.owner.accessToken();
    await settle();
    release();
    expect(await Promise.all([first, second])).toEqual([token('access-2'), token('access-2')]);
    expect(natives().filter((call) => call === 'accessToken')).toHaveLength(1);
    // the token the server may have rejected is the one that was in memory
    expect(phone.native.rejected).toEqual([token('access-1')]);
    expect(rig.client.calls).toEqual([]);
  });

  it('EVM-100 AC5: a valid access token is used without asking the module', async () => {
    const rig = await signedIn(phone);
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
    phone.native.calls.length = 0;
    rig.clock.advance(10 * 60_000);
    expect(await rig.owner.accessToken()).toBe(token('access-1'));
    expect(natives()).not.toContain('accessToken');
  });

  it('EVM-130 AC2: retry_later, unavailable and a module call that throws sign nobody out; the next request asks again', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    phone.native.accessScript.push({ status: 'retry_later' }, { status: 'unavailable' });
    expect(await rig.owner.refresh()).toBe('unavailable');
    expect(await rig.owner.refresh()).toBe('unavailable');
    rig.native.accessToken = () => Promise.reject(new Error('synthetic'));
    expect(await rig.owner.refresh()).toBe('unavailable');
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    rig.native.accessToken = start(phone).native.accessToken;
    phone.native.accessScript.push({ status: 'ready', accessToken: token('access-2'), ownerId: 'x', validForMs: 60_000 });
    expect(await rig.owner.accessToken()).toBe(token('access-2'));
  });

  it('EVM-130 AC2: a token that is about to expire (inside the skew) is asked for again', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000 - 10_000);
    phone.native.accessScript.push({ status: 'ready', accessToken: token('access-2'), ownerId: 'x', validForMs: 15 * 60_000 });
    expect(await rig.owner.accessToken()).toBe(token('access-2'));
  });

  it('EVM-130 AC2, AC5: blocked paused_revoked ends the session — N read first, replica and record go, the queue stays (TM-06)', async () => {
    const rig = await signedIn(phone);
    phone.queue = 5;
    phone.replica = true;
    const events = ended(rig);
    phone.native.accessScript.push({ status: 'blocked', state: 'paused_revoked' });
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(events).toEqual([{ reason: 'session_revoked', unsentItems: 5 }]);
    expect(phone.replica).toBe(false);
    expect(phone.queue).toBe(5);
    expect(phone.identity).not.toBeNull();
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(natives().filter((call) => call === 'accessToken')).toHaveLength(1);
  });

  it.each(['needs_login', 'signed_out'] as const)('EVM-130 AC5: blocked %s ends the session like a revoked one', async (state) => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    phone.native.accessScript.push({ status: 'blocked', state });
    expect(await rig.owner.refresh()).toBe('session_revoked');
    expect(events.map((e) => e.reason)).toEqual(['session_revoked']);
  });

  it('EVM-100 AC4, AC5: blocked wipe_required removes the record, locks the data and signals the wipe', async () => {
    const rig = await signedIn(phone);
    phone.queue = 3;
    const events = ended(rig);
    phone.native.accessScript.push({ status: 'blocked', state: 'wipe_required' });
    expect(await rig.owner.refresh()).toBe('device_wipe_required');
    expect(rig.wipe.signals).toBe(1);
    expect(events).toEqual([{ reason: 'device_wipe_required', unsentItems: 0 }]);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(phone.log).toContain('lock');
    expect(phone.log).not.toContain('endSession');
  });

  it('EVM-130 AC5: blocked paused_update (426) keeps the session and tells the screens about the update; nothing is removed', async () => {
    const rig = await signedIn(phone);
    const seen: string[] = [];
    const off = rig.owner.onUpdateRequired(() => seen.push('update'));
    phone.native.accessScript.push({ status: 'blocked', state: 'paused_update' });
    expect(await rig.owner.refresh()).toBe('unavailable');
    off();
    phone.native.accessScript.push({ status: 'blocked', state: 'paused_update' });
    await rig.owner.refresh();
    expect(seen).toEqual(['update']);
    expect(await rig.owner.currentUserId()).toBe(USER_A);
    expect(phone.slots.has('sessionMeta')).toBe(true);
    phone.native.accessScript.push({ status: 'blocked', state: 'signed_in' });
    expect(await rig.owner.refresh()).toBe('unavailable');
  });

  it('EVM-130 AC5: a state the module reports by an event (the job met 401 while the app was alive) is applied at once', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    rig.native.emit('onSessionState', { state: 'paused_revoked' });
    await settle();
    expect(events.map((e) => e.reason)).toEqual(['session_revoked']);
    expect(await rig.owner.currentUserId()).toBeNull();
    // without a session nothing more happens (the end is not repeated)
    rig.native.emit('onSessionState', { state: 'paused_revoked' });
    rig.native.emit('onSessionState', { state: 'wipe_required' });
    await settle();
    expect(events).toHaveLength(1);
  });

  it('EVM-130 AC2 (architect 4): the sync gate and an app request meeting 401 at the same time share one request to the module', async () => {
    const rig = await signedIn(phone);
    let release: () => void = () => undefined;
    const answers = [new Response(JSON.stringify({ code: 'unauthenticated' }), { status: 401 }), new Response('{}', { status: 200 })];
    const seen: string[] = [];
    const owner = new MobileSessionOwner({
      client: rig.client,
      tokens: rig.tokens,
      native: rig.native,
      host: rig.host,
      wipe: rig.wipe,
      clock: rig.clock,
      fetch: (request) => {
        seen.push(request.headers.get('Authorization') ?? '');
        return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
      },
    });
    expect(await owner.restore()).toEqual({ kind: 'signed_in' });
    expect(await owner.accessToken()).toBe(token('access-1'));
    phone.native.accessScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve({ status: 'ready', accessToken: token('access-2'), ownerId: 'x', validForMs: 15 * 60_000 });
        };
      }),
    );
    const gate = new SessionGate(owner);
    const viaSync = gate.onHttpFailure(401, undefined, USER_A, true);
    const viaApp = owner.authorizedFetch('https://api.example.test/api/v1/x');
    await settle();
    release();
    expect(await viaSync).toBe('retry');
    expect((await viaApp)?.status).toBe(200);
    expect(natives().filter((call) => call === 'accessToken')).toHaveLength(2);
    expect(seen).toEqual([`Bearer ${token('access-1')}`, `Bearer ${token('access-2')}`]);
  });

  it('EVM-100 AC5: device_wipe_required from the module pauses the sync gate with the wipe', async () => {
    const rig = await signedIn(phone);
    phone.native.accessScript.push({ status: 'blocked', state: 'wipe_required' });
    const gate = new SessionGate(rig.owner);
    expect(await gate.onHttpFailure(401, undefined, USER_A, true)).toBe('stop');
    expect(gate.paused).toBe('device_wipe_required');
  });
});

describe('"Sesja wygasła" or "Wylogowano ten telefon" (EVM-100 AC4, AC5; story decisions)', () => {
  const revoke = async (rig: { owner: MobileSessionOwner }) => {
    phone.native.accessScript.push({ status: 'blocked', state: 'paused_revoked' });
    await rig.owner.refresh();
  };

  it('EVM-100 AC5: more than 14 days without a successful contact → session_expired', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    rig.clock.advance(14 * DAY + 1);
    await revoke(rig);
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });

  it('EVM-100 AC5: a session older than 30 days → session_expired, even with contacts of the module in between', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    for (let n = 1; n <= 3; n += 1) {
      rig.clock.advance(10 * DAY);
      phone.native.contact = { wallMs: rig.clock.wall, monoMs: rig.clock.mono, bootId: 'boot-1', serverTimeMs: T0 + n * 10 * DAY };
      await rig.owner.mergeNativeContact();
    }
    rig.clock.advance(1);
    await revoke(rig);
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });

  it('EVM-100 AC4: within the limits, or with the phone clock set back, the variant is "Wylogowano ten telefon"', async () => {
    let rig = await signedIn(phone);
    let events = ended(rig);
    rig.clock.advance(3 * DAY);
    await revoke(rig);
    expect(events.map((e) => e.reason)).toEqual(['session_revoked']);
    phone = newPhone();
    rig = await signedIn(phone);
    events = ended(rig);
    rig.clock.wall -= 40 * DAY;
    rig.clock.mono += 40 * DAY;
    await revoke(rig);
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
    await revoke(rig);
    expect(events.map((e) => e.reason)).toEqual(['session_expired']);
  });
});

describe('authorizedFetch (EVM-100 AC4, AC5; EVM-130 AC2, AC5)', () => {
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
    return { rig, seen, client };
  };
  const problemResponse = (code: string) => new Response(JSON.stringify({ code }), { status: 401 });
  const ready = (n: number) => ({
    status: 'ready' as const,
    accessToken: token(`access-${String(n)}`),
    ownerId: 'x',
    validForMs: 15 * 60_000,
  });

  it('EVM-100 AC5: a plain 401 renews the token through the module (telling which was rejected) and retries once with the new one', async () => {
    const { rig, seen } = await rigWith([new Response(null, { status: 401 }), new Response('{}', { status: 200 })]);
    phone.native.accessScript.push(ready(2), ready(3));
    expect((await rig.owner.authorizedFetch('https://api.example.test/x', { headers: { Accept: 'application/json' } }))?.status).toBe(200);
    expect(seen).toEqual([`Bearer ${token('access-2')}`, `Bearer ${token('access-3')}`]);
    expect(phone.native.rejected.at(-1)).toBe(token('access-2'));
  });

  it('EVM-100 AC4, EVM-130 AC5: 401 session_revoked and device_wipe_required from any request are reported to the module and end the session without a refresh', async () => {
    const first = await rigWith([new Response('{}', { status: 200 }), problemResponse('session_revoked')]);
    const events = ended(first.rig);
    await first.rig.owner.authorizedFetch('https://api.example.test/x');
    expect((await first.rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(401);
    expect(events).toEqual([{ reason: 'session_revoked', unsentItems: 0 }]);
    expect(natives()).toContain('reportApiRevoked');
    phone = newPhone();
    const second = await rigWith([problemResponse('device_wipe_required')]);
    await second.rig.owner.authorizedFetch('https://api.example.test/x');
    expect(second.rig.wipe.signals).toBe(1);
    expect(natives()).toContain('reportDeviceWipeRequired');
    expect(await second.rig.owner.authorizedFetch('https://api.example.test/x')).toBeNull();
  });

  it('EVM-130 AC5: 426 from any request is reported to the module (the job pauses too); the response is returned as it is', async () => {
    const { rig } = await rigWith([new Response('{}', { status: 426 })]);
    expect((await rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(426);
    expect(natives()).toContain('reportUpdateRequired');
    expect(await rig.owner.currentUserId()).toBe(USER_A);
  });

  it('EVM-100 AC5: a failed renewal returns the 401 as it is; so does a renewal that gives the same token; without a session nothing is sent', async () => {
    const { rig } = await rigWith([
      new Response('{}', { status: 200 }),
      new Response('[]', { status: 401 }),
      new Response('[]', { status: 401 }),
    ]);
    await rig.owner.authorizedFetch('https://api.example.test/x');
    phone.native.accessScript.push({ status: 'retry_later' });
    expect((await rig.owner.authorizedFetch('https://api.example.test/x'))?.status).toBe(401);
    phone.native.accessScript.push(ready(1));
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

describe('sign-out through the module (EVM-100 AC7; EVM-130 AC2, AC5)', () => {
  it('EVM-100 AC7: online — the module signs out FIRST, then replica and record go; the queue and identity stay', async () => {
    const rig = await signedIn(phone);
    phone.queue = 2;
    phone.replica = true;
    const events = ended(rig);
    const before = phone.log.length;
    expect(await rig.owner.signOut({ online: true })).toEqual({ reason: 'signed_out', unsentItems: 2 });
    expect(phone.log.slice(before)).toEqual(['set:sessionMeta', 'native.signOut:online', 'endSession', 'delete:sessionMeta']);
    expect(events).toEqual([{ reason: 'signed_out', unsentItems: 2 }]);
    expect(phone.replica).toBe(false);
    expect(phone.queue).toBe(2);
    expect(phone.identity).not.toBeNull();
    expect([...phone.slots.keys()]).toEqual([]);
    expect(rig.client.calls).toEqual([]);
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.currentUserId()).toBeNull();
  });

  it('EVM-100 AC7 (W1a): offline the module is told so (its pending revocation is native); a restart finds a signed-out phone', async () => {
    const rig = await signedIn(phone);
    await rig.owner.signOut({ online: false });
    expect(natives()).toContain('signOut:offline');
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(await rig.owner.accessToken()).toBeNull();
    expect(await rig.owner.refresh()).toBe('session_revoked');
    const restarted = start(phone);
    expect(await restarted.owner.restore()).toEqual({ kind: 'signed_out' });
    expect(await restarted.owner.accessToken()).toBeNull();
  });

  it('EVM-108 pkt 13: the module says the capture cache stayed - the cleaning is repeated offline (no server), and a later success ends it quietly', async () => {
    const rig = await signedIn(phone);
    let answers = [false, false, true];
    rig.native.signOut = (online) => {
      phone.native.calls.push(`signOut:${online ? 'online' : 'offline'}`);
      return Promise.resolve(answers.shift() ?? true);
    };
    const result = await rig.owner.signOut({ online: true });
    expect(result).toEqual({ reason: 'signed_out', unsentItems: 0 });
    expect(natives().filter((call) => call.startsWith('signOut'))).toEqual(['signOut:online', 'signOut:offline', 'signOut:offline']);
    answers = [];
  });

  it('EVM-108 pkt 13: a cleaning that stays unfinished after the retries is told in the result - never dropped - and the screens still heard about the end once', async () => {
    const rig = await signedIn(phone);
    rig.native.signOut = (online) => {
      phone.native.calls.push(`signOut:${online ? 'online' : 'offline'}`);
      return Promise.resolve(false);
    };
    const events = ended(rig);
    const result = await rig.owner.signOut({ online: false });
    expect(result).toEqual({ reason: 'signed_out', unsentItems: 0, cleaningUnfinished: true });
    expect(events).toEqual([{ reason: 'signed_out', unsentItems: 0 }]);
    expect(natives().filter((call) => call.startsWith('signOut'))).toHaveLength(3);
  });

  it('EVM-108 pkt 13: a module call that throws counts as unfinished too', async () => {
    const rig = await signedIn(phone);
    rig.native.signOut = () => Promise.reject(new Error('module gone'));
    expect(await rig.owner.signOut({ online: false })).toMatchObject({ reason: 'signed_out', cleaningUnfinished: true });
  });

  it('EVM-108 pkt 13: with no session the module is still asked, so the cache of the camera goes', async () => {
    const rig = start(phone);
    await rig.owner.signOut({ online: true });
    expect(natives()).toContain('signOut:online');
  });

  it('EVM-100 AC7: the screens hear about the end BEFORE the answer of the server (the call of the module is still running)', async () => {
    const rig = await signedIn(phone);
    let release: () => void = () => undefined;
    phone.native.signOutHangs = new Promise((resolve) => {
      release = resolve;
    });
    const events = ended(rig);
    let done = false;
    const signingOut = rig.owner.signOut({ online: true }).then(() => {
      done = true;
    });
    await settle();
    expect(events).toHaveLength(1);
    expect(done).toBe(false);
    expect(phone.slots.has('sessionMeta')).toBe(false);
    release();
    await signingOut;
    expect(done).toBe(true);
  });

  it('EVM-100 AC7 (W1f): the sign-out waits for a running request for the access token (one lock), the HTTP calls of the sign-in steps too', async () => {
    const rig = await signedIn(phone);
    rig.clock.advance(15 * 60_000);
    let release: () => void = () => undefined;
    phone.native.accessScript.push(
      new Promise((resolve) => {
        release = () => {
          resolve({ status: 'ready', accessToken: token('access-2'), ownerId: 'x', validForMs: 60_000 });
        };
      }),
    );
    const refreshing = rig.owner.refresh();
    const signingOut = rig.owner.signOut({ online: false });
    const step1 = rig.owner.signInClient().login({ email: 'a@example.test', password: 'p' });
    await settle();
    expect(natives()).not.toContain('signOut:offline');
    expect(rig.client.calls).toEqual([]);
    release();
    expect(await refreshing).toBe('refreshed');
    await signingOut;
    expect((await step1).kind).toBe('ok');
    expect(natives().indexOf('signOut:offline')).toBeGreaterThan(natives().indexOf('accessToken'));
    const challenge = await rig.owner.signInClient().login({ email: 'a@example.test', password: 'p' });
    if (challenge.kind !== 'ok') throw new Error('expected a challenge');
    expect((await rig.owner.signInClient().loginTotp(challenge.value, '123456')).kind).toBe('ok');
  });

  it('EVM-100 AC7: signing out without a session asks no server (the module only cleans); a module call that throws does not stop the end of the session', async () => {
    const rig = start(phone);
    expect(await rig.owner.signOut({ online: true })).toEqual({ reason: 'signed_out', unsentItems: 0 });
    expect(natives()).toEqual(['signOut:online']);
    const signed = await signedIn(newPhone());
    signed.native.signOut = () => Promise.reject(new Error('synthetic'));
    expect((await signed.owner.signOut({ online: true })).reason).toBe('signed_out');
  });

  it('EVM-100 AC7: the pending revocations are sent by the module — at start, with the network and after a sign-in; never while a session of step 2 waits', async () => {
    const rig = start(phone);
    await rig.owner.flushPendingRevocation();
    expect(natives()).toEqual(['flushPendingRevocations']);
    phone.openAs = 'unavailable';
    await rig.owner.completeSignIn(issued());
    phone.native.calls.length = 0;
    await rig.owner.flushPendingRevocation();
    expect(natives()).toEqual([]);
    await rig.owner.abandonSignIn();
    await rig.owner.flushPendingRevocation();
    expect(natives()).toEqual(['abandonStaged', 'flushPendingRevocations']);
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

  it('EVM-130 AC5: the wipe of company data signs the module out first (online asks the server), locks the store and removes the record; no event', async () => {
    const rig = await signedIn(phone);
    const events = ended(rig);
    await rig.owner.endSessionForWipe({ online: true });
    expect(natives()).toContain('signOut:online');
    expect(phone.slots.has('sessionMeta')).toBe(false);
    expect(await rig.owner.currentUserId()).toBeNull();
    expect(events).toEqual([]);
    const offline = await signedIn(newPhone());
    await offline.owner.endSessionForWipe({ online: false });
    expect(offline.native.state.calls).toContain('signOut:offline');
  });
});

describe('the end of the session stops the synchronization first (EVM-107 AC5; security S2, S3)', () => {
  it('EVM-107 AC5: the store for the synchronization exists only for a signed-in session (null otherwise, also after the end)', async () => {
    const rig = start(phone);
    expect(rig.owner.syncStore()).toBeNull();
    await rig.owner.completeSignIn(issued());
    expect(rig.owner.syncStore()?.userId).toBe(USER_A);
    await rig.owner.signOut({ online: false });
    expect(rig.owner.syncStore()).toBeNull();
  });

  it('EVM-107 AC5: session_revoked, device_wipe_required, sign-out and the wipe of company data call the listeners BEFORE the replica is removed or the store is locked; a failing listener does not break the end', async () => {
    const orders: string[][] = [];
    for (const how of ['revoked', 'wipe_required', 'sign_out', 'company_wipe'] as const) {
      phone = newPhone();
      const rig = await signedIn(phone);
      const log: string[] = [];
      rig.owner.onBeforeSessionEnd(() => {
        log.push(`stop(endSession logged: ${String(phone.log.includes('endSession'))})`);
        throw new Error('a listener that fails');
      });
      const off = rig.owner.onBeforeSessionEnd(() => {
        log.push('removed listener');
      });
      off();
      phone.native.accessScript.push({ status: 'blocked', state: how === 'wipe_required' ? 'wipe_required' : 'paused_revoked' });
      if (how === 'revoked' || how === 'wipe_required') await rig.owner.refresh();
      else if (how === 'sign_out') await rig.owner.signOut({ online: false });
      else await rig.owner.endSessionForWipe({ online: false });
      orders.push(log);
    }
    expect(orders).toEqual(Array.from({ length: 4 }, () => ['stop(endSession logged: false)']));
  });
});
