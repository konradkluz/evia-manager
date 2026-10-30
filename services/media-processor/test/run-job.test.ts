import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runChild } from '../src/child.ts';
import { runJob } from '../src/run-job.ts';
import { JOB_ID, jobDirectory, photoWithMetadata, plainPng, stage } from './support/synthetic.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url));
const REQUEST = { jobId: JOB_ID, contentType: 'image/jpeg' } as const;

describe('EVM-068 AC3 a job runs in its own process that is killed on time (SR-FILE-04, SR-INFRA-11)', () => {
  it('EVM-068 AC3 a child that hangs is killed after the timeout and the answer is timeout', async () => {
    const started = Date.now();
    const result = await runJob(REQUEST, { workDir: '/nowhere', timeoutMs: 300, childFile: fixture('hang') });
    expect(result).toEqual({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('EVM-068 AC3 the next file of the batch converts after a job was killed (no effect on other jobs)', async () => {
    const hung = await runJob(REQUEST, { workDir: '/nowhere', timeoutMs: 200, childFile: fixture('hang') });
    expect(hung).toEqual({ ok: false, code: 'timeout' });
    const { workDir, dir } = await jobDirectory();
    await stage(dir, await photoWithMetadata(800, 400));
    const next = await runJob(REQUEST, { workDir });
    expect(next.ok).toBe(true);
    expect((await readFile(join(dir, 'thumbnail.webp'))).subarray(8, 12).toString('latin1')).toBe('WEBP');
  });

  it('EVM-068 AC3 a child killed by the system, one that exits silently and one that lies are all internal (the lie is not forwarded)', async () => {
    for (const name of ['crash', 'silent', 'lie']) {
      expect(await runJob(REQUEST, { workDir: '/nowhere', timeoutMs: 5000, childFile: fixture(name) })).toEqual({
        ok: false,
        code: 'internal',
      });
    }
  });

  it('EVM-068 AC3 a child that cannot be started is internal', async () => {
    expect(await runJob(REQUEST, { workDir: '/nowhere', childFile: fixture('does-not-exist') })).toEqual({ ok: false, code: 'internal' });
  });

  it('EVM-068 AC3 the real child reports a pixel bomb and a damaged file by code, with an empty environment', async () => {
    const { workDir, dir } = await jobDirectory();
    await stage(dir, Buffer.from('not a picture'));
    expect(await runJob(REQUEST, { workDir })).toEqual({ ok: false, code: 'unsupported' });
    await writeFile(join(dir, 'input'), await plainPng());
    expect(await runJob({ jobId: JOB_ID, contentType: 'image/png' }, { workDir })).toMatchObject({ ok: true });
  });
});

describe('EVM-068 AC5 the child accepts only a work directory and a valid request', () => {
  it('EVM-068 AC5 refuses a missing directory, a missing request and an invalid one', async () => {
    expect(await runChild([])).toBeUndefined();
    expect(await runChild(['/work'])).toBeUndefined();
    expect(await runChild(['/work', '{"jobId":"../x","contentType":"image/jpeg"}'])).toBeUndefined();
  });

  it('EVM-068 AC1 converts the staged file of the job it was given', async () => {
    const { workDir, dir } = await jobDirectory();
    await stage(dir, await plainPng());
    expect(await runChild([workDir, JSON.stringify({ jobId: JOB_ID, contentType: 'image/png' })])).toMatchObject({ ok: true });
  });
});
