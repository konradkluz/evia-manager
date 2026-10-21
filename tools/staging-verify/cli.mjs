#!/usr/bin/env node
// @ts-check
/**
 * staging-verify (EVM-007 AC6, bramka 10): node tools/staging-verify/cli.mjs wait | checks | report — see lib/main.mjs.
 * Environment: EXPECTED_COMMIT, EXPECTED_MANIFEST_SHA256 (output of publish), ZAP_REPORT, ZAP_RULES, GITHUB_STEP_SUMMARY.
 * No secret is read; everything runs anonymously against https://staging.eviacharge.pl.
 */
import { defaultIo, main } from './lib/main.mjs';

process.exitCode = await main(process.argv[2] ?? '', defaultIo('.scratch/staging-verify'));
