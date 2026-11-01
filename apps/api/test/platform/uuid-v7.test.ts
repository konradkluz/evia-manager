import { describe, expect, it } from 'vitest';
import { uuidV7 } from '../../src/platform/ids/uuid-v7.ts';

describe('UUIDv7 of the server (EVM-099 AC1)', () => {
  it('EVM-099 AC1 is a version 7 variant 1 UUID that carries the time and sorts by it', () => {
    const early = uuidV7(1_700_000_000_000);
    const late = uuidV7(1_700_000_000_001);
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(early < late).toBe(true);
    expect(uuidV7(1_700_000_000_000)).not.toBe(early);
  });

  it('EVM-099 AC1 without an argument it takes the time of the clock', () => {
    const before = Date.now();
    const id = uuidV7();
    const embedded = Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(embedded).toBeGreaterThanOrEqual(before);
    expect(embedded).toBeLessThanOrEqual(Date.now());
  });
});
