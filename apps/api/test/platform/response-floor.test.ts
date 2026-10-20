import { describe, expect, it } from 'vitest';
import { enforceResponseFloor, type Sleeper } from '../../src/platform/http/response-floor.ts';
import { FixedClock } from '../support/clock.ts';

class RecordingSleeper implements Sleeper {
  readonly slept: number[] = [];
  sleep(milliseconds: number): Promise<void> {
    this.slept.push(milliseconds);
    return Promise.resolve();
  }
}

describe('the floor of the response time (EVM-025 AC1; CWE-208)', () => {
  it('EVM-025 AC1 a response that is ready at once waits for the whole floor, counted from the start of the request', async () => {
    const clock = new FixedClock('2026-10-05T08:00:00.000Z');
    const sleeper = new RecordingSleeper();
    await enforceResponseFloor(clock, sleeper, new Date('2026-10-05T08:00:00.000Z'), 250);
    expect(sleeper.slept).toEqual([250]);
  });

  it('EVM-025 AC1 only the rest of the floor is waited for, and nothing when the work already took longer', async () => {
    const clock = new FixedClock('2026-10-05T08:00:00.100Z');
    const sleeper = new RecordingSleeper();
    await enforceResponseFloor(clock, sleeper, new Date('2026-10-05T08:00:00.000Z'), 250);
    clock.set('2026-10-05T08:00:00.250Z');
    await enforceResponseFloor(clock, sleeper, new Date('2026-10-05T08:00:00.000Z'), 250);
    clock.set('2026-10-05T08:00:01.000Z');
    await enforceResponseFloor(clock, sleeper, new Date('2026-10-05T08:00:00.000Z'), 250);
    expect(sleeper.slept).toEqual([150]);
  });

  it('EVM-025 AC1 the real sleeper waits for the time it is asked for', async () => {
    const { TimerSleeper } = await import('../../src/platform/http/response-floor.ts');
    const before = performance.now();
    await new TimerSleeper().sleep(15);
    expect(performance.now() - before).toBeGreaterThanOrEqual(10);
  });
});
