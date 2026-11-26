#!/usr/bin/env node
// @ts-check
/**
 * Image scan of bramka 6 outside publish (EVM-153): the `images-scan` job of ci.yml (pull requests and pushes) and the nightly
 * `image-digests` job of nightly.yml; see lib/scan.mjs. From the repository root, Docker required.
 *   node tools/image-scan/cli.mjs [--save-platform] [--only evia-api,infra-caddy]
 * --save-platform: `docker save --platform linux/arm64` (Docker Desktop with the containerd image store; the runners do not need it).
 * Exit code 0 = every image has 0 High/Critical with a fix and no secret; 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { runFromRepository } from './lib/scan.mjs';

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? null : (args[onlyIndex + 1] ?? '').split(',').filter((name) => name !== '');

process.exitCode = runFromRepository({
  env: process.env,
  savePlatform: args.includes('--save-platform'),
  only,
  log: (line) => {
    console.log(line);
  },
  exec: (command, commandArgs, options) => {
    const result = spawnSync(command, commandArgs, options?.capture ? { encoding: 'utf8' } : { stdio: 'inherit' });
    return { status: result.status ?? 1, stdout: typeof result.stdout === 'string' ? result.stdout : '' };
  },
});
