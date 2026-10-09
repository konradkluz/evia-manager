/**
 * Entry point of the development tool: `node .dev-build/dev/cli.js state | seed` (started by tools/dev-env after the build with
 * tsconfig.dev.json). Compiled output of this directory never reaches `dist/` or the API image (tsconfig.build.json lists
 * `src/` only; the Dockerfile copies no `dev/`).
 */
import { defaultDeps, runDevCli } from './run.ts';

/* v8 ignore start -- process entry point; runDevCli() is covered by tests */
if (import.meta.main) {
  process.exitCode = await runDevCli(process.argv.slice(2), process.env, process, await defaultDeps());
}
/* v8 ignore stop */
