/**
 * Entry point of the worker process (`node dist/src/worker.js`; ADR-0010, EVM-034 step 9): the same image as the API, a different
 * command. It takes the jobs of the queue as the application role — no HTTP server, no migration. SIGTERM stops it gracefully.
 */
/* v8 ignore start -- process entry point; the wiring and the run are covered by tests */
if (import.meta.main) {
  const { runWorkerFromProcess } = await import('./worker/worker-process.ts');
  process.exitCode = await runWorkerFromProcess(process.env, { stdout: process.stdout, signals: process, process });
}
/* v8 ignore stop */
