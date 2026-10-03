import { describe, expect, it } from 'vitest';
import { coverageExclusions, parseCoverageExclusions } from '../src/coverage-exclusions.ts';

describe('coverage exclusions — single source (EVM-006 AC3, W3a)', () => {
  it('EVM-006 AC3: the repository file lists patterns, each with a reason', () => {
    const patterns = coverageExclusions();
    expect(patterns).toContain('**/test/**');
    expect(patterns).toContain('**/node_modules/**');
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('EVM-006 AC3: an entry without a reason is rejected', () => {
    expect(() => parseCoverageExclusions('{"exclude":[{"pattern":"**/x/**","reason":""}]}')).toThrow(/reason/);
    expect(() => parseCoverageExclusions('{"exclude":[{"pattern":"","reason":"r"}]}')).toThrow(/pattern/);
  });

  it('EVM-006 AC3: a file without an exclude list is rejected', () => {
    expect(() => parseCoverageExclusions('{}')).toThrow(/exclude/);
    expect(() => parseCoverageExclusions('[]')).toThrow(/exclude/);
    expect(() => parseCoverageExclusions('{"exclude":["**/x/**"]}')).toThrow(/pattern/);
  });
});
