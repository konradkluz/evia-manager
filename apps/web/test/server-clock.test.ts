import { afterEach, describe, expect, it } from 'vitest';
import { noteServerDate, resetServerClock, serverNow } from '../src/session/server-clock.ts';

afterEach(resetServerClock);

describe('server clock (EVM-067 AC6; SR-WEB-05)', () => {
  it('EVM-067 AC6 the Date header of the server sets the difference; a missing or unreadable header changes nothing', () => {
    expect(serverNow(1000)).toBe(1000);
    noteServerDate(new Date(Date.now() + 300_000).toUTCString());
    expect(Math.abs(serverNow(1000) - 301_000)).toBeLessThan(2000);
    noteServerDate(null);
    noteServerDate(undefined);
    noteServerDate('not a date');
    expect(Math.abs(serverNow(1000) - 301_000)).toBeLessThan(2000);
  });
});
