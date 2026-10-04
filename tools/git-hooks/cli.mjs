#!/usr/bin/env node
// @ts-check
/**
 * Git hooks installation and check (EVM-006 AC5) — tools/git-hooks/README.md.
 *   node tools/git-hooks/cli.mjs install | check
 */
import { git, lefthook, main } from './lib/main.mjs';

process.exitCode = main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (line) => {
    console.log(line);
  },
  stderr: (line) => {
    console.error(line);
  },
  git,
  lefthook,
});
