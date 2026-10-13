#!/usr/bin/env node
// @ts-check
/**
 * Change detection of ci.yml (EVM-083, ADR-0018) — decides whether the heavy jobs (e2e-web, backend-integration,
 * coverage) may be skipped: only when every changed file is documentation (see lib/classify.mjs).
 * Environment: EVENT_NAME, BASE_SHA (from .github/workflows/ci.yml), GITHUB_OUTPUT. Fail closed: any problem
 * means heavy=true (the full set runs).
 */
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { detect } from './lib/classify.mjs';

const result = detect({
  eventName: process.env['EVENT_NAME'] ?? '',
  baseSha: process.env['BASE_SHA'] ?? '',
  diff: (base) => execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD', '--'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
});
console.log(`heavy=${String(result.heavy)} (${result.reason})`);
const output = process.env['GITHUB_OUTPUT'];
if (output) appendFileSync(output, `heavy=${String(result.heavy)}\n`);
