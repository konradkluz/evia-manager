import { describe, expect, it } from 'vitest';
import {
  INVALID_PAYLOAD,
  InMemoryJobQueue,
  JOB_FAILED,
  JOB_NAME,
  JobFailure,
  MAX_PAYLOAD_IDS,
  jobPayloadSchema,
  runHandler,
} from '../../src/platform/jobs/index.ts';
import { assertJobName, parsePayload } from '../../src/platform/jobs/job-queue.ts';
import { uuidv7 } from '../support/uuid.ts';

describe('the job queue interface (EVM-034 W11; ADR-0010; TM-26, TM-72)', () => {
  it('EVM-034 W11 a payload is a list of UUIDs and nothing else: free text, unknown keys and too long lists are refused', () => {
    expect(jobPayloadSchema.safeParse({ ids: [] }).success).toBe(true);
    expect(jobPayloadSchema.safeParse({ ids: [uuidv7()] }).success).toBe(true);
    expect(jobPayloadSchema.safeParse({ ids: ['jan@example.invalid'] }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ids: [], note: 'text' }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({}).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ids: Array.from({ length: MAX_PAYLOAD_IDS + 1 }, () => uuidv7()) }).success).toBe(false);
  });

  it('EVM-034 W11 a job name is `<module>.<job>` in lower case', () => {
    for (const valid of ['overview.verify-projection', 'email.send', 'a.b.c']) expect(JOB_NAME.test(valid)).toBe(true);
    for (const invalid of ['verify', 'Overview.Verify', 'overview.', "x.y'; drop table", 'a b.c']) {
      expect(JOB_NAME.test(invalid)).toBe(false);
      expect(() => {
        assertJobName(invalid);
      }).toThrow(/job name/);
    }
  });

  it('EVM-034 W11 a job of the schedule has no payload; a payload that does not pass the schema is refused with a fixed code', () => {
    expect(parsePayload(undefined)).toEqual({ ids: [] });
    expect(parsePayload(null)).toEqual({ ids: [] });
    expect(() => parsePayload({ ids: ['x'] })).toThrow(expect.objectContaining({ code: INVALID_PAYLOAD }) as Error);
  });

  it('EVM-034 W11 whatever a handler throws becomes the failure with a fixed code, the code of a JobFailure is kept', async () => {
    const driver = Object.assign(new Error('value of the row'), { detail: 'Key (email)=(jan@example.invalid)' });
    const wrapped = await runHandler(() => Promise.reject(driver), { ids: [] }).catch((error: unknown) => error);
    expect(wrapped).toBeInstanceOf(JobFailure);
    expect(wrapped).toMatchObject({ code: JOB_FAILED, message: JOB_FAILED });
    expect(JSON.stringify(wrapped)).not.toContain('example');
    await expect(runHandler(() => Promise.reject(new JobFailure('custom_code')), { ids: [] })).rejects.toMatchObject({
      code: 'custom_code',
    });
    expect(await runHandler(() => Promise.resolve({ checked: 1 }), { ids: [] })).toEqual({ checked: 1 });
    expect(await runHandler(() => Promise.resolve(undefined), undefined)).toBeUndefined();
  });

  it('EVM-034 W11 the in-memory queue delivers what was sent, one by one, and validates like the real one', async () => {
    const queue = new InMemoryJobQueue();
    const seen: string[][] = [];
    await queue.start();
    await queue.work('overview.sample-job', (payload) => {
      seen.push([...payload.ids]);
      return Promise.resolve({ done: payload.ids.length });
    });
    await queue.schedule('overview.sample-job', { cron: '30 3 * * *', timezone: 'Europe/Warsaw' });
    const id = uuidv7();
    await queue.send('overview.sample-job', [id]);
    await expect(queue.send('overview.sample-job', ['not-a-uuid'])).rejects.toThrow();
    await expect(queue.send('Bad Name', [])).rejects.toThrow(/job name/);
    expect(await queue.runDue()).toEqual([{ done: 1 }]);
    expect(seen).toEqual([[id]]);
    expect(queue.schedules.get('overview.sample-job')?.cron).toBe('30 3 * * *');
    queue.pending.push({ name: 'overview.missing', payload: { ids: [] } });
    await expect(queue.runDue()).rejects.toThrow('no handler');
    await queue.stop();
    expect(queue.started && queue.stopped).toBe(true);
  });
});
