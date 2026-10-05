// @ts-check
/**
 * Runs a named task of timed-task.mjs in a worker thread with a hard deadline (EVM-013 AC6). The `timeout` of
 * node:test cannot stop synchronous code, so a regression (e.g. catastrophic backtracking) would hang the CI job
 * until `timeout-minutes`; here `worker.terminate()` stops the computation and the test fails with a message about
 * the exceeded deadline.
 */
import { Worker } from 'node:worker_threads';

/** Hard deadline of one task — far above the measured limit (2 s), far below the step and job timeouts. */
export const DEADLINE_MS = 10_000;

const TASK_MODULE = new URL('./timed-task.mjs', import.meta.url);

/** @typedef {{ elapsed: number, result: any }} TimedResult time measured inside the worker (ms) and the task's result */

/**
 * @param {string} task name of a task in timed-task.mjs
 * @param {unknown} input structured-cloneable input of the task
 * @param {{ deadlineMs?: number }} [options]
 * @returns {Promise<TimedResult>}
 */
export async function runTimed(task, input, { deadlineMs = DEADLINE_MS } = {}) {
  const worker = new Worker(TASK_MODULE, { workerData: { task, input } });
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  /** @type {Promise<TimedResult>} */
  const finished = new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      reject(new Error(`wątek zakończył się bez wyniku (kod ${code})`));
    });
  });
  /** @type {Promise<never>} */
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`przekroczono twardy termin ${deadlineMs} ms — wątek przerwany (worker.terminate)`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([finished, deadline]);
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
