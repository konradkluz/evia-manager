#!/usr/bin/env node
// @ts-check
/**
 * evia-node-test — runs node:test with coverage for tools written as dependency-free .mjs (EVM-006 W2, W3).
 * Thresholds: 90% lines and branches (shared packages and tools/, testing-strategy.md). Exclusions come from
 * coverage-exclusions.json; the lcov report in coverage/lcov.info feeds tools/diff-coverage.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageExclusions } from './coverage-exclusions.js';
import { COVERAGE_THRESHOLDS } from './vitest.js';

/** @returns {string[]} */
export function nodeTestArgs() {
  const threshold = COVERAGE_THRESHOLDS.shared;
  return [
    '--test',
    '--experimental-test-coverage',
    `--test-coverage-lines=${String(threshold)}`,
    `--test-coverage-branches=${String(threshold)}`,
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

/**
 * @typedef {object} RunOptions
 * @property {string} cwd
 * @property {string} execPath
 * @property {(path: string) => void} rm
 * @property {(path: string) => void} mkdir
 * @property {(command: string, args: string[], cwd: string) => number} spawn
 */

/**
 * @param {RunOptions} options
 * @returns {number} exit status of node --test
 */
export function runNodeTests({ cwd, execPath, rm, mkdir, spawn }) {
  rm(join(cwd, 'coverage', 'lcov.info'));
  mkdir(join(cwd, 'coverage'));
  return spawn(execPath, nodeTestArgs(), cwd);
}

/* v8 ignore start -- process wiring (bin entry point), exercised by every tool's test:coverage script */
// The bin is reached through a node_modules symlink: compare real paths.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
