/**
 * Vitest coverage preset (ADR-0014, EVM-006). Thresholds follow docs/process/testing-strategy.md and work
 * as a ratchet: they may only go up (lowering needs an ADR and Konrad's approval).
 */
import { coverageExclusions } from './coverage-exclusions.ts';

/** Global line and branch thresholds per layer, in percent. */
export const COVERAGE_THRESHOLDS = Object.freeze({ shared: 90, backend: 85, web: 80, mobile: 80 });

export type Layer = keyof typeof COVERAGE_THRESHOLDS;

export interface CoveragePreset {
  readonly enabled: true;
  readonly provider: 'v8';
  readonly reporter: string[];
  readonly reportsDirectory: string;
  readonly include: string[];
  readonly exclude: string[];
  readonly thresholds: { readonly lines: number; readonly branches: number };
}

/**
 * @param options.include source files measured even when no test loads them (no "uninstrumented = green")
 */
export function coverage({ layer, include }: { layer: Layer; include: string[] }): CoveragePreset {
  if (!Object.hasOwn(COVERAGE_THRESHOLDS, layer)) throw new Error(`unknown coverage layer: ${layer}`);
  if (include.length === 0) throw new Error('coverage include list must not be empty');
  const threshold = COVERAGE_THRESHOLDS[layer];
  return {
    enabled: true,
    provider: 'v8',
    reporter: ['text', 'lcov'],
    reportsDirectory: 'coverage',
    include,
    exclude: coverageExclusions(),
    thresholds: { lines: threshold, branches: threshold },
  };
}
