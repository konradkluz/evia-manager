#!/usr/bin/env node
// @ts-check
/**
 * Local development environment (EVM-077) — tools/dev-env/README.md.
 *   node tools/dev-env/cli.mjs init | dev | admin | seed | stop | reset
 * Run directly by the package.json scripts (never through turbo: turbo keeps task output in .turbo/*.log).
 */
import { main } from './src/main.mjs';
import { processDeps } from './src/process.mjs';

process.exitCode = await main(process.argv.slice(2), processDeps(process.cwd()));
