#!/usr/bin/env node
// @ts-check
/**
 * Nightly alarm of a red publication on main (EVM-153 AC4b) — the `publish-watch` job of nightly.yml; see lib/watch.mjs.
 * Environment: GITHUB_TOKEN (the job token, `actions: read`, set only on this step), GITHUB_API_URL, GITHUB_REPOSITORY,
 * GITHUB_SERVER_URL (all set by the runner). Exit code 1 = red publication or any problem reading the data (fail-closed).
 */
import { run } from './lib/watch.mjs';

process.exitCode = await run({
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  now: new Date(),
  log: (line) => {
    console.log(line);
  },
});
