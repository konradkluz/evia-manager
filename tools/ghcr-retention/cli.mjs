#!/usr/bin/env node
// @ts-check
/**
 * GHCR retention (EVM-007 AC2) — a step of the publish job; see lib/retention.mjs (runFromEnv). Environment:
 * GITHUB_TOKEN (the job token: actions: read, packages: write), GITHUB_REPOSITORY (owner/name), GHCR_RETENTION_MODE
 * (`dry-run` — the default and the only mode in ci.yml until the IaC session confirms deletion with GITHUB_TOKEN).
 * A failed retention never fails the release: it is reported and nothing is deleted.
 */
import { githubApi, runFromEnv } from './lib/retention.mjs';

await runFromEnv(process.env, githubApi, (line) => {
  console.log(line);
});
