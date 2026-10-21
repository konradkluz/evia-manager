#!/usr/bin/env node
// @ts-check
/**
 * Maestro smoke test of the mobile app on an Android emulator (EVM-009 AC4) — tools/mobile-e2e/README.md.
 *   node tools/mobile-e2e/cli.mjs [--skip-build] [--port <n>]
 */
import { resolve } from 'node:path';
import { main } from './src/main.mjs';
import { realHost } from './src/process.mjs';

process.exitCode = await main(process.argv.slice(2), realHost(resolve(import.meta.dirname, '..', '..')));
