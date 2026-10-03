// @ts-check
import { describe, expect, it } from 'vitest';
import { coverageExclusions } from '../src/coverage-exclusions.js';
import { COVERAGE_THRESHOLDS, coverage } from '../src/vitest.js';

describe('Vitest preset (EVM-006 AC3)', () => {
  it('EVM-006 AC3: thresholds follow docs/process/testing-strategy.md (shared and tools 90, backend 85, web and mobile 80)', () => {
    expect(COVERAGE_THRESHOLDS).toEqual({ shared: 90, backend: 85, web: 80, mobile: 80 });
  });

  it('EVM-006 AC3: coverage uses V8, writes lcov and enforces line and branch thresholds', () => {
    const config = coverage({ layer: 'shared', include: ['src/**/*.ts'] });
    expect(config).toEqual({
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: coverageExclusions(),
      thresholds: { lines: 90, branches: 90 },
    });
  });

  it('EVM-006 AC3: an unknown layer is rejected instead of falling back to a lower threshold', () => {
    // @ts-expect-error — the layer is checked at runtime as well
    expect(() => coverage({ layer: 'other', include: ['src/**'] })).toThrow(/layer/);
  });

  it('EVM-006 AC3: an empty include list is rejected (uninstrumented code would look green)', () => {
    expect(() => coverage({ layer: 'backend', include: [] })).toThrow(/include/);
  });
});
