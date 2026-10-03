// @ts-check
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverageExclusions } from '../src/coverage-exclusions.js';
import { nodeTestArgs, runNodeTests } from '../src/node-test.js';

describe('evia-node-test — node:test with coverage for tools/*.mjs (EVM-006 AC2, AC3)', () => {
  it('EVM-006 AC3: thresholds 90% lines and branches, all source files, exclusions from the shared file, lcov for diff coverage', () => {
    const args = nodeTestArgs();
    expect(args.slice(0, 2)).toEqual(['--test', '--experimental-test-coverage']);
    for (const part of [
      '--test-coverage-lines=90',
      '--test-coverage-branches=90',
      '--test-coverage-include-all',
      '--test-coverage-include=**/*.mjs',
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=lcov',
      '--test-reporter-destination=coverage/lcov.info',
    ]) {
      expect(args).toContain(part);
    }
    for (const pattern of coverageExclusions()) expect(args).toContain(`--test-coverage-exclude=${pattern}`);
    expect(args.at(-1)).toBe('test/**/*.test.mjs');
  });

  it('EVM-006 AC3: removes a stale report, creates the coverage directory and returns the exit code of node', () => {
    /** @type {string[]} */
    const calls = [];
    const status = runNodeTests({
      cwd: '/repo/tools/x',
      execPath: '/usr/bin/node',
      rm: (path) => calls.push(`rm ${path}`),
      mkdir: (path) => calls.push(`mkdir ${path}`),
      spawn: (command, args, cwd) => {
        calls.push(`spawn ${command} ${args.length} ${cwd}`);
        return 1;
      },
    });
    expect(status).toBe(1);
    expect(calls).toEqual([
      `rm ${join('/repo/tools/x', 'coverage', 'lcov.info')}`,
      `mkdir ${join('/repo/tools/x', 'coverage')}`,
      `spawn /usr/bin/node ${nodeTestArgs().length} /repo/tools/x`,
    ]);
  });
});
