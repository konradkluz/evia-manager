/**
 * The entry of the child process of ONE job (EVM-068 AC3; SR-FILE-04, SR-INFRA-11). The parent kills it after the timeout whatever it is doing,
 * so a hang inside libvips (a thread of its pool, which no timer of this process could stop) never outlives the job. The environment of the
 * child is empty. The answer travels over the IPC channel; the child then exits.
 */
import { join } from 'node:path';
import { convert, restrictParsers } from './convert.ts';
import { parseRequest, type JobResult } from './protocol.ts';

/** @returns the result of the job, or `undefined` when the arguments are not a work directory and a valid request */
export async function runChild(argv: readonly string[]): Promise<JobResult | undefined> {
  const [workDir, line] = argv;
  const request = line === undefined ? undefined : parseRequest(line);
  if (workDir === undefined || request === undefined) return undefined;
  restrictParsers();
  return convert(join(workDir, request.jobId), request.contentType);
}

/* v8 ignore start -- process wiring of the child (runChild() is tested; the fork and the kill by run-job.ts) */
if (import.meta.main) {
  const result = await runChild(process.argv.slice(2));
  if (result === undefined || process.send === undefined) process.exit(2);
  process.send(result, () => {
    process.exit(0);
  });
}
/* v8 ignore stop */
