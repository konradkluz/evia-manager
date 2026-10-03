#!/usr/bin/env node
// @ts-check
/**
 * Entry point of the changed-code coverage gate (EVM-006 AC3) — tools/diff-coverage/README.md.
 *   node tools/diff-coverage/cli.mjs [clean]
 */
import { main } from './lib/main.mjs';

process.exitCode = main(process.argv.slice(2), { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
