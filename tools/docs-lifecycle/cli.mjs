#!/usr/bin/env node
// @ts-check
/**
 * Entry point of the document lifecycle validator (EVM-012) — docs/process/document-lifecycle.md.
 *   node tools/docs-lifecycle/cli.mjs check [--list] [--today YYYY-MM-DD] [--summary]
 *   node tools/docs-lifecycle/cli.mjs cleanup-report <M#> [--today YYYY-MM-DD]
 * Thin wrapper: the logic lives in lib/main.mjs. It sets `process.exitCode` and never terminates
 * the process explicitly, so output piped to another program is never cut off (finding I).
 */
import { main } from './lib/main.mjs';

process.exitCode = main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  now: () => new Date(),
  stdout: process.stdout,
  stderr: process.stderr,
});
