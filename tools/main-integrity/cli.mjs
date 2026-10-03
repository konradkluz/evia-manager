#!/usr/bin/env node
// @ts-check
/**
 * K6 — integrity of main after a push (EVM-006, ADR-0016) — tools/main-integrity/README.md.
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY, MAIN_MERGER, BEFORE, AFTER, FORCED (set by .github/workflows/ci.yml).
 */
import { main } from './lib/main.mjs';

process.exitCode = await main({
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  log: (line) => {
    console.log(line);
  },
});
