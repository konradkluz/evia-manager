// The contact of the native side and the 7-day rule (EVM-130; architect 9, security 3, SR-MOB-05/06): a refresh made by the job while no
// JavaScript ran counts as a contact, but it never brings back data that are already hidden.
import { rig as guardRig } from '../device-guard/fakes';
import { T0 } from './fixtures';
import { newPhone, signedIn, start, type FakeClock, type Phone, type Rig } from './fakes';

const DAY = 86_400_000;
let phone: Phone;
beforeEach(() => {
  phone = newPhone();
});

/** A contact of the module `daysAgo` days ago, as `lastContact()` reports it (in the frame of the clock of the test). */
const contactBack = (clock: FakeClock, daysAgo: number, serverTimeMs: number | null = null): void => {
  const at = clock.wall - daysAgo * DAY;
  phone.native.contact = {
    wallMs: at,
    monoMs: clock.mono - daysAgo * DAY,
    bootId: clock.boot,
    serverTimeMs: serverTimeMs ?? at,
  };
};
const advance = (rig: Rig, days: number): void => {
  rig.clock.advance(days * DAY);
};

describe('the contact of the module counts for the 7 days (EVM-130 architect 9)', () => {
  it('EVM-130 AC2: a refresh in the background (no JavaScript) 1 day ago makes 6 days of silence 1 day — the later of the two checkpoints wins', async () => {
    const rig = await signedIn(phone);
    advance(rig, 6);
    expect((await rig.owner.contactStatus())?.status).toEqual({ visible: true, elapsedMs: 6 * DAY });
    contactBack(rig.clock, 1);
    await rig.owner.mergeNativeContact();
    expect(phone.contact).toMatchObject({ serverTime: T0 + 5 * DAY, wall: T0 + 5 * DAY, carried: 0 });
    expect((await rig.owner.contactStatus())?.status).toEqual({ visible: true, elapsedMs: DAY });
  });

  it('EVM-130 AC2: an older or equal contact of the module changes nothing (the own checkpoint is the later one)', async () => {
    const rig = await signedIn(phone);
    advance(rig, 3);
    phone.log.length = 0;
    phone.native.contact = { wallMs: T0 - DAY, monoMs: 1, bootId: 'boot-1', serverTimeMs: T0 - DAY };
    await rig.owner.mergeNativeContact();
    phone.native.contact = { wallMs: T0, monoMs: 1000, bootId: 'boot-1', serverTimeMs: T0 };
    await rig.owner.mergeNativeContact();
    expect(phone.log).not.toContain('saveContact');
    expect(phone.contact).toMatchObject({ serverTime: T0 });
  });

  it('EVM-130 AC2: the contact of the module is merged at start, after an event of the module and into the record of the session (the 14-day rule)', async () => {
    await signedIn(phone);
    const rig = start(phone);
    advance(rig, 4);
    contactBack(rig.clock, 1);
    expect(await rig.owner.restore()).toEqual({ kind: 'signed_in' });
    expect(phone.contact).toMatchObject({ serverTime: T0 + 3 * DAY });
    expect(JSON.parse(phone.slots.get('sessionMeta') ?? '{}')).toMatchObject({ lastContact: { serverTime: T0 + 3 * DAY } });
    advance(rig, 1);
    contactBack(rig.clock, 0);
    await rig.owner.mergeNativeContact();
    expect(phone.contact).toMatchObject({ serverTime: T0 + 5 * DAY });
  });

  it('EVM-130 AC2: a refresh that the app asks for itself merges the contact the module made while answering', async () => {
    const rig = await signedIn(phone);
    advance(rig, 2);
    contactBack(rig.clock, 0);
    expect(await rig.owner.refresh()).toBe('refreshed');
    expect(phone.contact).toMatchObject({ serverTime: T0 + 2 * DAY });
  });
});

describe('a contact from the background never brings data back (EVM-130; security 3, SR-MOB-05/06)', () => {
  it('EVM-130 AC2, AC5: after 7 days the data are hidden; a background contact later is NOT recorded — only a full sign-in brings them back', async () => {
    const rig = await signedIn(phone);
    advance(rig, 8);
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'window_elapsed' });
    contactBack(rig.clock, 0.5);
    await rig.owner.mergeNativeContact();
    // (the evaluation itself keeps the highest wall time it saw; the contact stays the old one)
    expect(phone.contact).toMatchObject({ serverTime: T0 });
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'window_elapsed' });
    // the same rule after the end of the window of the server (a shortened window)
    const again = await signedIn(phone, 3, start(phone, { clock: rig.clock }));
    expect((await again.owner.contactStatus())?.status.visible).toBe(true);
  });

  it('EVM-130 AC2, AC5: a clock anomaly stays hidden too; so does data without any record of contact', async () => {
    const rig = await signedIn(phone);
    rig.clock.mono -= 1;
    expect((await rig.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'clock_anomaly' });
    contactBack(rig.clock, 0, T0 + DAY);
    await rig.owner.mergeNativeContact();
    expect((await rig.owner.contactStatus())?.status.visible).toBe(false);

    const other = newPhone();
    other.hasData = true;
    const second = await signedIn(other);
    other.contact = undefined;
    other.native.contact = { wallMs: second.clock.wall, monoMs: second.clock.mono, bootId: 'boot-1', serverTimeMs: second.clock.wall };
    other.log.length = 0;
    await second.owner.mergeNativeContact();
    expect(other.log).not.toContain('saveContact');
    expect((await second.owner.contactStatus())?.status).toMatchObject({ visible: false, reason: 'no_contact_record' });
  });

  it('EVM-130 AC2: a replica without data has nothing to hide — its first contact of the module is recorded', async () => {
    const rig = await signedIn(phone);
    phone.contact = undefined;
    phone.hasData = false;
    contactBack(rig.clock, 0);
    await rig.owner.mergeNativeContact();
    expect(phone.contact).toMatchObject({ serverTime: T0 });
  });

  it('EVM-130 AC2, AC5: without a screen lock the data stay hidden whatever the module contacted — the contact never touches that decision', async () => {
    const rig = await signedIn(phone);
    const guard = guardRig({ contact: () => rig.owner.contactStatus() });
    guard.facts.secure = false;
    await guard.guard.refresh();
    expect(guard.guard.getSnapshot().hidden).toBe('screen_lock_off');
    advance(rig, 2);
    contactBack(rig.clock, 0);
    await rig.owner.mergeNativeContact();
    await guard.guard.refresh();
    expect(guard.guard.getSnapshot().hidden).toBe('screen_lock_off');
    // the lock is back: the contact of the module is a contact, the data are visible by the 7-day rule
    guard.facts.secure = true;
    await guard.guard.refresh();
    expect(guard.guard.getSnapshot().hidden).toBeNull();
  });

  it('EVM-130 AC2: a contact without a server time, with impossible numbers, a module that throws or no session is ignored', async () => {
    const rig = await signedIn(phone);
    advance(rig, 3);
    phone.log.length = 0;
    const bad = [
      { wallMs: 1, monoMs: 1, bootId: 'boot-1', serverTimeMs: null },
      { wallMs: Number.NaN, monoMs: 1, bootId: 'boot-1', serverTimeMs: T0 + 1 },
      { wallMs: 1, monoMs: -1, bootId: 'boot-1', serverTimeMs: T0 + 1 },
      { wallMs: 1, monoMs: 1, bootId: '', serverTimeMs: T0 + 1 },
      { wallMs: 1, monoMs: 1, bootId: 'x'.repeat(200), serverTimeMs: T0 + 1 },
      { wallMs: 1, monoMs: 1, bootId: 'boot-1', serverTimeMs: Number.POSITIVE_INFINITY },
    ];
    for (const contact of bad) {
      phone.native.contact = contact;
      await rig.owner.mergeNativeContact();
    }
    expect(phone.log).not.toContain('saveContact');
    rig.native.lastContact = () => Promise.reject(new Error('synthetic'));
    await expect(rig.owner.mergeNativeContact()).resolves.toBeUndefined();
    await expect(start(newPhone()).owner.mergeNativeContact()).resolves.toBeUndefined();
  });

  it('EVM-130 AC2: a store that cannot save the checkpoint never fails the session', async () => {
    const rig = await signedIn(phone);
    advance(rig, 2);
    contactBack(rig.clock, 0);
    phone.faults.set('set:sessionMeta', 'fail');
    await expect(rig.owner.mergeNativeContact()).resolves.toBeUndefined();
    expect(await rig.owner.currentUserId()).not.toBeNull();
  });
});
