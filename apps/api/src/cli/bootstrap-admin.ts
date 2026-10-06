/**
 * Entry point of the server command: `docker exec -it <api> node dist/src/cli/bootstrap-admin.js` (first Administrator)
 * and `… --emergency --reason <powód>` (RR-16). The terminal check is the very first thing that happens — before the
 * application, the database and the arguments are touched — and the rest is loaded only afterwards (docs/ops/runbooks).
 */
import { interactiveRefusal } from './tty-guard.ts';

/* v8 ignore start -- process wiring of the command entry point; the guard, the arguments and the run are covered by tests */
if (import.meta.main) {
  const refusal = interactiveRefusal({
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    pid: process.pid,
    ppid: process.ppid,
  });
  if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 2;
  } else {
    const { runFromProcess } = await import('./run.ts');
    process.exitCode = await runFromProcess(process.argv.slice(2));
  }
}
/* v8 ignore stop */
