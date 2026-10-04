#!/usr/bin/env node
// @ts-check
/**
 * Security scans, scanner self-test and gitleaks hooks (EVM-006) — tools/scan/README.md.
 *   node tools/scan/cli.mjs all | security | licenses | selftest | hook pre-commit | hook pre-push
 */
import { defaultIo, main } from './lib/main.mjs';

process.exitCode = main(process.argv.slice(2), defaultIo(process.cwd()));
