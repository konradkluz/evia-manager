#!/usr/bin/env node
// @ts-check
/**
 * Change detection of ci.yml (EVM-083, ADR-0018) — decides which heavy jobs may be skipped (EVM-083, EVM-086): coverage
 * only for documentation-only changes, e2e-web / backend-integration when every changed file is listed as not relevant
 * (see lib/classify.mjs).
 * `mobile` (EVM-009) is a positive list: mobile-apk runs when a file that can change the Android package changed.
 * Environment: EVENT_NAME, BASE_SHA (from .github/workflows/ci.yml), GITHUB_OUTPUT. Fail closed: any problem
 * means heavy=e2e=integration=mobile=true (the full set runs).
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detect } from './lib/classify.mjs';

const result = detect({
  eventName: process.env['EVENT_NAME'] ?? '',
  baseSha: process.env['BASE_SHA'] ?? '',
  diff: (base) =>
    execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
});
const lines = [
  `heavy=${String(result.heavy)}`,
  `e2e=${String(result.e2e)}`,
  `integration=${String(result.integration)}`,
  `mobile=${String(result.mobile)}`,
];
console.log(`${lines.join(' ')} (${result.reason})`);
const output = process.env['GITHUB_OUTPUT'];
if (output) appendFileSync(output, `${lines.join('\n')}\n`);
