/**
 * Entry point of the server command of the read model (EVM-034): `node dist/src/cli/overview.js rebuild|verify [--only <uuid> …]`
 * in the container of the API (no HTTP route, no panel — ADR-0017 W11). The application is loaded only when the command runs.
 */
/* v8 ignore start -- process wiring of the command entry point; the arguments, the run and the wiring are covered by tests */
if (import.meta.main) {
  const { runOverviewFromProcess } = await import('./overview-process.ts');
  process.exitCode = await runOverviewFromProcess(process.argv.slice(2), process.env, process);
}
/* v8 ignore stop */
