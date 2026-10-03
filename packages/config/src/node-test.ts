#!/usr/bin/env node
/**
 * evia-node-test — runs node:test with coverage for tools written as dependency-free .mjs (EVM-006 W2, W3).
 * Thresholds: 90% lines and branches (shared packages and tools/, testing-strategy.md). Exclusions come from
 * coverage-exclusions.json; the lcov report in coverage/lcov.info feeds tools/diff-coverage.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { coverageExclusions } from './coverage-exclusions.ts';
import { COVERAGE_THRESHOLDS } from './vitest.ts';

export function nodeTestArgs(): string[] {
  const threshold = COVERAGE_THRESHOLDS.shared;
  return [
    '--test',
    '--experimental-test-coverage',
    `--test-coverage-lines=${threshold}`,
    `--test-coverage-branches=${threshold}`,
    '--test-coverage-include-all',
    '--test-coverage-include=**/*.mjs',
    ...coverageExclusions().map((pattern) => `--test-coverage-exclude=${pattern}`),
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/lcov.info',
    'test/**/*.test.mjs',
  ];
}

export interface RunOptions {
  readonly cwd: string;
  readonly execPath: string;
  readonly rm: (path: string) => void;
  readonly mkdir: (path: string) => void;
  readonly spawn: (command: string, args: string[], cwd: string) => number;
}

/** @returns exit status of node --test (a stale report is removed first, so it can never pass for a new run) */
export function runNodeTests({ cwd, execPath, rm, mkdir, spawn }: RunOptions): number {
  rm(join(cwd, 'coverage', 'lcov.info'));
  mkdir(join(cwd, 'coverage'));
  return spawn(execPath, nodeTestArgs(), cwd);
}

/* v8 ignore start -- process wiring of the bin; runNodeTests() is covered by tests */
if (import.meta.main) {
  process.exitCode = runNodeTests({
    cwd: process.cwd(),
    execPath: process.execPath,
    rm: (path) => {
      rmSync(path, { force: true });
    },
    mkdir: (path) => {
      mkdirSync(path, { recursive: true });
    },
    spawn: (command, args, cwd) => spawnSync(command, args, { cwd, stdio: 'inherit' }).status ?? 1,
  });
}
/* v8 ignore stop */
