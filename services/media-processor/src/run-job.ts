/**
 * Runs ONE job in a child process and returns its result (EVM-068 AC3; SR-FILE-04, SR-INFRA-11). `fork` of a fixed file, an argument vector and no
 * shell (SR-INPUT-04): the job reaches the child only as the work directory and the validated request. After {@link JOB_TIMEOUT_MS} the child
 * gets SIGKILL — a hang in libvips or a pixel bomb that eats the memory ends with the child, and the next job of the batch starts clean.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JOB_TIMEOUT_MS, parseResult, type JobRequest, type JobResult } from './protocol.ts';

const CHILD = fileURLToPath(new URL('./child.ts', import.meta.url));

export interface RunOptions {
  readonly workDir: string;
  readonly timeoutMs?: number;
  /** Tests only: another file to fork (a child that hangs, crashes or lies). */
  readonly childFile?: string;
}

export function runJob(request: JobRequest, options: RunOptions): Promise<JobResult> {
  return new Promise((resolve) => {
    const child = fork(options.childFile ?? CHILD, [options.workDir, JSON.stringify(request)], {
      env: {},
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    });
    let answer: JobResult | undefined;
    let settled = false;
    const finish = (result: JobResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, code: 'timeout' });
    }, options.timeoutMs ?? JOB_TIMEOUT_MS);
    child.on('message', (message) => {
      answer ??= parseResult(message);
    });
    child.on('error', () => {
      finish({ ok: false, code: 'internal' });
    });
    child.on('exit', () => {
      // killed by a signal (the OOM killer) or exited without a valid answer: the file is not certainly at fault, so `internal` (retried and counted)
      finish(answer ?? { ok: false, code: 'internal' });
    });
  });
}
