#!/usr/bin/env node
// @ts-check
/**
 * Change detection of ci.yml (EVM-083, ADR-0018) — decides which heavy jobs may be skipped (EVM-083, EVM-086): coverage
 * only for documentation-only changes, e2e-web / backend-integration when every changed file is listed as not relevant
 * (see lib/classify.mjs); EVM-007: `iac` (iac-check) and `publish` (release images for a push to main).
 * Environment: EVENT_NAME, BASE_SHA (from .github/workflows/ci.yml), GITHUB_OUTPUT. Fail closed: any problem
 * means heavy=e2e=integration=iac=true (the full set runs) and, for a push, publish=true.
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detect, detectDeployment } from './lib/classify.mjs';

const input = {
  eventName: process.env['EVENT_NAME'] ?? '',
  baseSha: process.env['BASE_SHA'] ?? '',
  /** @param {string} base */
  diff: (base) =>
    execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
};
const result = detect(input);
const deployment = detectDeployment(input);
const lines = [
  `heavy=${String(result.heavy)}`,
  `e2e=${String(result.e2e)}`,
  `integration=${String(result.integration)}`,
  `iac=${String(deployment.iac)}`,
  `publish=${String(deployment.publish)}`,
];
console.log(`${lines.join(' ')} (${result.reason}; ${deployment.reason})`);
const output = process.env['GITHUB_OUTPUT'];
if (output) appendFileSync(output, `${lines.join('\n')}\n`);
