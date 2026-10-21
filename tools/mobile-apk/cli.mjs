#!/usr/bin/env node
// @ts-check
/**
 * Verification of the built Android APK and its digest (EVM-009 AC5, AC6) — tools/mobile-apk/README.md.
 *   node tools/mobile-apk/cli.mjs verify|digest --apk <file> [--application-id <id>] [--signed]
 *   node tools/mobile-apk/cli.mjs sign --apk <file> --expect-sha256 <digest> --keystore <file> --key-alias <alias> --out <file>
 */
import { main } from './src/main.mjs';
import { realHost } from './src/process.mjs';

process.exitCode = main(process.argv.slice(2), realHost());
