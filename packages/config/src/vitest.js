// @ts-check
/**
 * Vitest coverage preset (ADR-0014, EVM-006). Thresholds follow docs/process/testing-strategy.md and work
 * as a ratchet: they may only go up (lowering needs an ADR and Konrad's approval).
 */
import { coverageExclusions } from './coverage-exclusions.js';

/** Global line and branch thresholds per layer, in percent. */
export const COVERAGE_THRESHOLDS = Object.freeze({ shared: 90, backend: 85, web: 80, mobile: 80 });

/** @typedef {keyof typeof COVERAGE_THRESHOLDS} Layer */

/**
 * @param {{ layer: Layer, include: string[] }} options `include` lists the source files measured even when no test loads them
 */
export function coverage({ layer, include }) {
  if (!Object.hasOwn(COVERAGE_THRESHOLDS, layer)) throw new Error(`unknown coverage layer: ${layer}`);
  if (include.length === 0) throw new Error('coverage include list must not be empty');
  const threshold = COVERAGE_THRESHOLDS[layer];
  return {
    enabled: true,
    provider: /** @type {const} */ ('v8'),
    reporter: ['text', 'lcov'],
    reportsDirectory: 'coverage',
    include,
    exclude: coverageExclusions(),
    thresholds: { lines: threshold, branches: threshold },
  };
}
