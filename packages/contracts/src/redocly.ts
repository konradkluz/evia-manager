/**
 * Runs the Redocly CLI of this package (lint and bundle) with telemetry and update checks switched off — no data
 * leaves the machine or CI, also when redocly.yaml fails to load (EVM-008 AC2).
 *   node src/redocly.ts lint   → lints openapi/openapi.yaml with redocly.yaml (exit code of the CLI)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(import.meta.resolve('@redocly/cli/bin/cli.js'));
export const SPECIFICATION = 'openapi/openapi.yaml';

export function redoclyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true' };
}

export interface RedoclyResult {
  readonly status: number;
  readonly output: string;
}

/** @param args arguments after `redocly` (the package configuration is always added) */
export function runRedocly(args: readonly string[]): RedoclyResult {
  const result = spawnSync(process.execPath, [CLI, ...args, '--config', 'redocly.yaml'], {
    encoding: 'utf8',
    env: redoclyEnv(process.env),
  });
  return { status: result.status === 0 ? 0 : 1, output: `${result.stdout}${result.stderr}` };
}

export const lintContract = (file: string): RedoclyResult => runRedocly(['lint', file, '--format', 'stylish']);

export const bundleContract = (output: string): RedoclyResult => runRedocly(['bundle', SPECIFICATION, '--output', output]);

/* v8 ignore start -- process wiring of the lint entry point; lintContract() is covered by tests */
if (import.meta.main) {
  const result = lintContract(SPECIFICATION);
  process.stdout.write(result.output);
  process.exitCode = result.status;
}
/* v8 ignore stop */
