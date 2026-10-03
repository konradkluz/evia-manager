// @ts-check
/**
 * Single source of coverage exclusions (EVM-006 W3a): coverage-exclusions.json is read by the Vitest
 * preset, by evia-node-test and — without installed dependencies — by tools/diff-coverage.
 */
import { readFileSync } from 'node:fs';

const FILE = new URL('../coverage-exclusions.json', import.meta.url);

/**
 * @param {string} text
 * @returns {string[]} glob patterns, each documented with a reason in the file
 */
export function parseCoverageExclusions(text) {
  /** @type {unknown} */
  const data = JSON.parse(text);
  const list =
    typeof data === 'object' && data !== null && !Array.isArray(data)
      ? /** @type {Record<string, unknown>} */ (data)['exclude']
      : undefined;
  if (!Array.isArray(list)) throw new Error('coverage-exclusions.json: missing "exclude" list');
  return /** @type {unknown[]} */ (list).map((entry, index) => {
    const item = /** @type {Record<string, unknown>} */ (typeof entry === 'object' && entry !== null ? entry : {});
    const { pattern, reason } = item;
    if (typeof pattern !== 'string' || pattern === '') throw new Error(`coverage-exclusions.json: entry ${index} has no pattern`);
    if (typeof reason !== 'string' || reason.trim() === '')
      throw new Error(`coverage-exclusions.json: entry ${index} (${pattern}) has no reason`);
    return pattern;
  });
}

/** @returns {string[]} */
export function coverageExclusions() {
  return parseCoverageExclusions(readFileSync(FILE, 'utf8'));
}
