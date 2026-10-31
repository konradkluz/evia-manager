import { describe, expect, it } from 'vitest';
import { ContactClock, evaluateContact, newContact, parseContactRecord, windowDays } from '../src/contact-clock.ts';
import { FakeClock } from './helpers.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20, 8, 0, 0);

class FakeMono {
  mono = 1000;
  boot = 'boot-1';
  monotonicNow(): number {
    return this.mono;
  }
  bootId(): string {
    return this.boot;
  }
}

function setup(): { cc: ContactClock; clock: FakeClock; mono: FakeMono; last: () => unknown } {
  const saved: unknown[] = [];
  const clock = new FakeClock(T0);
  const mono = new FakeMono();
  const cc = new ContactClock(
    {
      saveContact: (r) => {
        saved.push(JSON.parse(JSON.stringify(r)));
        return Promise.resolve();
      },
    },
    clock,
    mono,
  );
  return { cc, clock, mono, last: () => saved[saved.length - 1] };
}

const maxWall = (record: unknown): number => (record as { maxObservedWall: number }).maxObservedWall;

describe('last contact resistant to the clock (EVM-092 AC7)', () => {
  it('EVM-092 AC7: within one boot the elapsed time comes from the monotonic clock; a wall clock set back is an anomaly', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.mono += 6 * DAY;
    s.clock.ms -= 3 * DAY;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'clock_anomaly' });
    s.clock.ms = T0 + 6 * DAY;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
    s.mono.mono += 2 * DAY;
    s.clock.ms += 10 * 60_000;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'window_elapsed' });
  });

  it('EVM-092 AC7: a wall clock moved forward within one boot does not shorten the window (monotonic time decides)', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.mono += 1000;
    s.clock.ms += 30 * DAY;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
  });

  it('EVM-092 AC7: after a restart the elapsed time comes from the wall clock and is carried across restarts', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.boot = 'boot-2';
    s.mono.mono = 5;
    s.clock.ms = T0 + 3 * DAY;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
    s.mono.boot = 'boot-3';
    s.clock.ms = T0 + 6 * DAY;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
    s.mono.boot = 'boot-4';
    s.clock.ms = T0 + 7 * DAY + 1;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'window_elapsed' });
  });

  it('EVM-092 AC7: a clock set back after a restart (below the highest observed time) is fail-closed until it catches up', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.clock.ms = T0 + DAY;
    await s.cc.visibility(s.last(), true, 7);
    s.mono.boot = 'boot-2';
    s.clock.ms = T0 + DAY - 60_000;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'clock_anomaly' });
    s.clock.ms = T0 + DAY + 1;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
  });

  it('EVM-092 AC7: a clock set below the wall reading at the contact is fail-closed (below serverTime in the corrected frame)', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.boot = 'boot-2';
    s.clock.ms = T0 - 1;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'clock_anomaly' });
  });

  for (const skew of [-120_000, 120_000]) {
    it(`EVM-092 AC7: a phone ${skew / 60_000} min off the server clock is not fail-closed after every restart (offset frame)`, async () => {
      const s = setup();
      s.clock.ms = T0 + skew;
      await s.cc.record(T0);
      for (let boot = 2; boot < 5; boot += 1) {
        s.mono.boot = `boot-${boot}`;
        s.clock.ms += 60_000;
        expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
      }
    });
  }

  it('EVM-092 AC7: same boot with a monotonic value lower than stored, NaN and negative elapsed are fail-closed', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.mono = 10;
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: false, reason: 'clock_anomaly' });
    s.mono.mono = Number.NaN;
    expect((await s.cc.visibility(s.last(), true, 7)).visible).toBe(false);
    const record = newContact(T0, T0, 1000, 'boot-1');
    expect(evaluateContact(record, { wall: Number.NaN, mono: 1, bootId: 'boot-1' }).ok).toBe(false);
    expect(evaluateContact(record, { wall: T0, mono: 1, bootId: '' }).ok).toBe(false);
    expect(evaluateContact({ ...record, carried: -5 }, { wall: T0, mono: 1000, bootId: 'boot-1' }).ok).toBe(false);
    expect(evaluateContact({ ...record, carried: Number.POSITIVE_INFINITY }, { wall: T0, mono: 1000, bootId: 'boot-1' }).ok).toBe(false);
  });

  it('EVM-092 AC7: a missing or undecodable record hides a non-empty replica; an empty replica has nothing to hide', async () => {
    const s = setup();
    const good = newContact(1, 1, 1, 'b');
    for (const raw of [undefined, null, 'x', [], {}, { v: 2 }, { ...good, bootId: '' }, { ...good, mono: 'a' }]) {
      expect(await s.cc.visibility(raw, true, 7)).toEqual({ visible: false, reason: 'no_contact_record' });
      expect(await s.cc.visibility(raw, false, 7)).toEqual({ visible: true });
    }
    expect(parseContactRecord({ ...good, carried: -1 })).toBeNull();
  });

  it('EVM-092 AC7: the highest observed wall time is persisted on every evaluation, also a failed one', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.clock.ms = T0 + 5000;
    await s.cc.visibility(s.last(), true, 7);
    expect(maxWall(s.last())).toBe(T0 + 5000);
    s.mono.mono = 0;
    s.clock.ms = T0 + 9000;
    await s.cc.visibility(s.last(), true, 7);
    expect(maxWall(s.last())).toBe(T0 + 9000);
  });

  it('EVM-092 AC7: a new authenticated contact re-anchors the record, also after a clock anomaly', async () => {
    const s = setup();
    await s.cc.record(T0);
    s.mono.boot = 'boot-2';
    s.clock.ms = T0 - DAY;
    expect((await s.cc.visibility(s.last(), true, 7)).visible).toBe(false);
    await s.cc.record(T0 + 1000);
    expect(await s.cc.visibility(s.last(), true, 7)).toEqual({ visible: true });
  });

  it('EVM-092 AC7: the window comes from the configuration: 1-7 days, anything else or missing means 7 (never longer)', async () => {
    expect([1, 3, 7].map(windowDays)).toEqual([1, 3, 7]);
    for (const bad of [undefined, 0, 8, 90, -1, 2.5, '3', null, Number.NaN]) expect(windowDays(bad)).toBe(7);
    const s = setup();
    await s.cc.record(T0);
    s.mono.mono += 2 * DAY;
    expect(await s.cc.visibility(s.last(), true, 1)).toEqual({ visible: false, reason: 'window_elapsed' });
    expect(await s.cc.visibility(s.last(), true, 3)).toEqual({ visible: true });
    expect(await s.cc.visibility(s.last(), true, 90)).toEqual({ visible: true });
  });

  it('EVM-092 AC7: time zone and DST do not change the result (all arithmetic is on UTC epochs)', async () => {
    const previous = process.env['TZ'];
    try {
      for (const tz of ['UTC', 'Europe/Warsaw', 'America/Los_Angeles', 'Pacific/Auckland']) {
        process.env['TZ'] = tz;
        const springForward = Date.UTC(2026, 2, 29, 0, 30, 0);
        const autumnBack = Date.UTC(2026, 9, 25, 0, 30, 0);
        const row: boolean[] = [];
        for (const start of [springForward, autumnBack]) {
          const s = setup();
          s.clock.ms = start;
          await s.cc.record(start);
          s.mono.boot = 'boot-2';
          s.clock.ms = start + 7 * DAY - 1;
          row.push((await s.cc.visibility(s.last(), true, 7)).visible);
          s.mono.boot = 'boot-3';
          s.clock.ms = start + 7 * DAY;
          row.push((await s.cc.visibility(s.last(), true, 7)).visible);
        }
        expect(row, tz).toEqual([true, false, true, false]);
      }
    } finally {
      if (previous === undefined) delete process.env['TZ'];
      else process.env['TZ'] = previous;
    }
  });
});
