#!/usr/bin/env node
// @ts-check
/**
 * Entry point of the backend-tests image (infra/docker/backend-tests/Dockerfile) — tools/container/README.md.
 * Fixed container paths; the logic and its tests live in lib/sync.mjs.
 */
import { spawnSync } from 'node:child_process';
import { main } from './lib/sync.mjs';

process.exitCode = main(process.argv.slice(2), {
  src: '/src',
  repo: '/work/repo',
  store: '/work/pnpm-store',
  out: '/out',
  spawn: (command, args, cwd) => spawnSync(command, args, { cwd, stdio: 'inherit' }).status ?? 1,
  log: (line) => {
    console.error(line);
  },
});
