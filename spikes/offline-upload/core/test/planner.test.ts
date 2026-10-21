import { describe, expect, it } from 'vitest';
import { GiB, MiB, planParts } from '../src/planner.ts';

describe('EVM-011 AC1 part planner (Scaleway: 1-1000 parts, each >= 5 MiB except the last)', () => {
  it('EVM-011 AC1 splits a 500 MB file into 16 MiB parts with a smaller last part', () => {
    const size = 500 * 1000 * 1000;
    const plan = planParts(size);
    expect(plan.partSize).toBe(16 * MiB);
    expect(plan.parts).toHaveLength(Math.ceil(size / (16 * MiB)));
    const last = plan.parts.at(-1)!;
    expect(last.offset + last.length).toBe(size);
    expect(plan.parts.slice(0, -1).every((p) => p.length === 16 * MiB)).toBe(true);
    expect(plan.parts.reduce((s, p) => s + p.length, 0)).toBe(size);
  });

  it('EVM-011 AC1 numbers parts from 1 and keeps offsets contiguous', () => {
    const plan = planParts(40 * MiB + 1);
    expect(plan.parts.map((p) => p.number)).toEqual([1, 2, 3]);
    let expected = 0;
    for (const p of plan.parts) {
      expect(p.offset).toBe(expected);
      expected += p.length;
    }
  });

  it('EVM-011 AC1 uses a single (small) part for files below the minimum part size', () => {
    const plan = planParts(123);
    expect(plan.parts).toEqual([{ number: 1, offset: 0, length: 123 }]);
  });

  it('EVM-011 AC1 never exceeds 1000 parts for 4 GiB, raising the part size when needed', () => {
    const plan = planParts(4 * GiB);
    expect(plan.parts.length).toBeLessThanOrEqual(1000);
    expect(plan.partSize).toBeLessThanOrEqual(64 * MiB);
  });

  it('EVM-011 AC1 raises the part size for a file that would need more than maxParts at the preferred size', () => {
    const plan = planParts(30 * GiB, { maxFileBytes: 64 * GiB, maxParts: 1000 });
    expect(plan.parts.length).toBeLessThanOrEqual(1000);
    expect(plan.partSize % MiB).toBe(0);
  });

  it('EVM-011 AC1 rejects files that cannot fit in maxParts at the largest allowed part size', () => {
    expect(() => planParts(100 * GiB, { maxFileBytes: 200 * GiB })).toThrow(/too large/);
  });

  it('EVM-011 AC1 rejects empty files, over-limit files and non-integer sizes', () => {
    expect(() => planParts(0)).toThrow(/size/);
    expect(() => planParts(1.5)).toThrow(/size/);
    expect(() => planParts(4 * GiB + 1)).toThrow(/limit/);
  });

  it('EVM-011 AC1 validates a requested part size against the 8-64 MiB range and the 5 MiB provider minimum', () => {
    expect(planParts(100 * MiB, {}, 8 * MiB).partSize).toBe(8 * MiB);
    expect(() => planParts(100 * MiB, {}, 4 * MiB)).toThrow(/part size/);
    expect(() => planParts(100 * MiB, {}, 65 * MiB)).toThrow(/part size/);
    expect(() => planParts(100 * MiB, {}, 8 * MiB + 1)).toThrow(/part size/);
  });

  it('EVM-011 AC1 treats maxParts as a provider parameter (AWS-like 10000 allows smaller parts)', () => {
    const plan = planParts(4 * GiB, { maxParts: 10000 }, 8 * MiB);
    expect(plan.parts).toHaveLength(512);
  });
});
