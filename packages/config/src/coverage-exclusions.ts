/**
 * Single source of coverage exclusions (EVM-006 W3a): coverage-exclusions.json is read by the Vitest
 * preset, by evia-node-test and — without installed dependencies — by tools/diff-coverage.
 */
import { readFileSync } from 'node:fs';

const FILE = new URL('../coverage-exclusions.json', import.meta.url);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @returns glob patterns, each documented with a reason in the file */
export function parseCoverageExclusions(text: string): string[] {
  const data: unknown = JSON.parse(text);
  const list = isRecord(data) ? data['exclude'] : undefined;
  if (!Array.isArray(list)) throw new Error('coverage-exclusions.json: missing "exclude" list');
  return list.map((entry: unknown, index) => {
    const { pattern, reason } = isRecord(entry) ? entry : {};
    if (typeof pattern !== 'string' || pattern === '') throw new Error(`coverage-exclusions.json: entry ${index} has no pattern`);
    if (typeof reason !== 'string' || reason.trim() === '')
      throw new Error(`coverage-exclusions.json: entry ${index} (${pattern}) has no reason`);
    return pattern;
  });
}

export function coverageExclusions(): string[] {
  return parseCoverageExclusions(readFileSync(FILE, 'utf8'));
}
