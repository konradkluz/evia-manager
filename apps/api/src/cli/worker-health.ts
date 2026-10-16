/**
 * The healthcheck of the worker container (`node dist/src/cli/worker-health.js`; EVM-024 AC6): exit code 0 when the worker wrote its health
 * file in the last two minutes and its transport of e-mail can send, 1 otherwise (stuck, down, or transport `none`). No output: a
 * healthcheck prints nothing a person could mistake for a log of the worker.
 */
import { DEFAULT_HEALTH_FILE, isWorkerHealthy } from '../worker/worker-health.ts';

/* v8 ignore start -- process entry point; the check itself is covered by tests */
if (import.meta.main) {
  process.exitCode = (await isWorkerHealthy(DEFAULT_HEALTH_FILE, new Date())) ? 0 : 1;
}
/* v8 ignore stop */
