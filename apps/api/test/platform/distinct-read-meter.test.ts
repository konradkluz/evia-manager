import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryDistinctReadMeter } from '../../src/platform/bulk-read/distinct-read-meter.ts';
import { FixedClock, HOUR, MINUTE } from '../support/clock.ts';

const START = '2026-10-08T08:00:00.000Z';
const some = (count: number): string[] => Array.from({ length: count }, () => randomUUID());

describe('meter of different objects read by a user (EVM-039 AC5; SR-API-02, P10, RR-13; ASVS V2.4.1)', () => {
  it('EVM-039 AC5 300 different customers raise no alert, the 301st raises it — once per window', () => {
    const meter = new InMemoryDistinctReadMeter(new FixedClock(START));
    const user = randomUUID();
    expect(meter.record(user, 'customer', some(100))).toBe(false);
    expect(meter.record(user, 'customer', some(100))).toBe(false);
    expect(meter.record(user, 'customer', some(100))).toBe(false); // 300
    expect(meter.record(user, 'customer', some(1))).toBe(true); // the 301st
    expect(meter.record(user, 'customer', some(50))).toBe(false); // the same window: once
  });

  it('EVM-039 AC5 the same customer again is not a different one: any number of reads of 300 customers stays quiet', () => {
    const meter = new InMemoryDistinctReadMeter(new FixedClock(START));
    const user = randomUUID();
    const ids = some(300);
    for (let round = 0; round < 5; round += 1) expect(meter.record(user, 'customer', ids)).toBe(false);
  });

  it('EVM-039 AC5 the window slides: an identifier not read for an hour drops out, so the count falls and the alert can come again', () => {
    const clock = new FixedClock(START);
    const meter = new InMemoryDistinctReadMeter(clock);
    const user = randomUUID();
    expect(meter.record(user, 'customer', some(301))).toBe(true);
    clock.advance(59 * MINUTE);
    expect(meter.record(user, 'customer', some(1))).toBe(false); // still the same window
    clock.advance(2 * MINUTE); // the first 301 are older than an hour; one identifier is left
    expect(meter.record(user, 'customer', some(299))).toBe(false); // 300 in the window
    expect(meter.record(user, 'customer', some(1))).toBe(true); // 301 again, a new window
  });

  it('EVM-039 AC5 an identifier read again moves to the end of the window: it lives an hour from the LAST read', () => {
    const clock = new FixedClock(START);
    const meter = new InMemoryDistinctReadMeter(clock);
    const user = randomUUID();
    const kept = some(1);
    meter.record(user, 'customer', kept);
    clock.advance(40 * MINUTE);
    meter.record(user, 'customer', kept);
    clock.advance(40 * MINUTE); // 80 minutes after the first read, 40 after the second
    expect(meter.record(user, 'customer', some(300))).toBe(true); // `kept` is still counted: 301
  });

  it('EVM-039 AC5 the count is per user: another user starts from zero, and the alert of one does not silence the other', () => {
    const meter = new InMemoryDistinctReadMeter(new FixedClock(START));
    const [first, second] = [randomUUID(), randomUUID()];
    expect(meter.record(first, 'customer', some(301))).toBe(true);
    expect(meter.record(second, 'customer', some(300))).toBe(false);
    expect(meter.record(second, 'customer', some(1))).toBe(true);
  });

  it('EVM-039 AC5 an empty read counts nothing', () => {
    const meter = new InMemoryDistinctReadMeter(new FixedClock(START), { alertAbove: 0 });
    expect(meter.record(randomUUID(), 'customer', [])).toBe(false);
  });

  it('EVM-039 AC5 the memory of a user is bounded to threshold + 1 identifiers, and the alert still comes once for a huge read', () => {
    const meter = new InMemoryDistinctReadMeter(new FixedClock(START), { alertAbove: 3 });
    const user = randomUUID();
    expect(meter.record(user, 'customer', some(5000))).toBe(true);
    expect(meter.record(user, 'customer', some(5000))).toBe(false);
  });

  it('EVM-039 AC5 a full table sweeps idle users first and never costs the ACTIVE user the counter', () => {
    const clock = new FixedClock(START);
    const meter = new InMemoryDistinctReadMeter(clock, { alertAbove: 3 }, 3);
    const [active, quiet, idle] = [randomUUID(), randomUUID(), randomUUID()];
    meter.record(idle, 'customer', some(1));
    clock.advance(2 * HOUR); // `idle` has nothing left in the window
    meter.record(active, 'customer', some(3));
    meter.record(quiet, 'customer', some(1));
    meter.record(randomUUID(), 'customer', some(1)); // the table is full: `idle` is swept, nobody else is lost
    expect(meter.record(active, 'customer', some(1))).toBe(true); // the counter of `active` was not zeroed (4 > 3)
  });

  it('EVM-039 AC5 when nobody is idle the least recently active user is evicted — never the one who has just read', () => {
    const clock = new FixedClock(START);
    const meter = new InMemoryDistinctReadMeter(clock, { alertAbove: 3 }, 2);
    const [oldest, active] = [randomUUID(), randomUUID()];
    meter.record(oldest, 'customer', some(3));
    clock.advance(MINUTE);
    meter.record(active, 'customer', some(3));
    clock.advance(MINUTE);
    meter.record(randomUUID(), 'customer', some(1)); // full: `oldest` goes
    expect(meter.record(active, 'customer', some(1))).toBe(true); // `active` kept its 3 and passes the threshold
    expect(meter.record(oldest, 'customer', some(1))).toBe(false); // `oldest` started again from zero
  });
});
