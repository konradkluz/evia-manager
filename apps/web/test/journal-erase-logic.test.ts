import type { TimelineEntry } from '@evia/contracts';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { StepUpCancelled } from '../src/administration/use-guarded-call.ts';
import { ApiError } from '../src/api/client.ts';
import { describeEraseFailure, eraseFailureText, replaceEntryInCache } from '../src/work-orders/journal-erase.ts';
import { WORK_ORDER_JOURNAL_KEY } from '../src/work-orders/query-keys.ts';

describe('mapping of the failures of delete, restore and redact (EVM-040 AC3, AC5, AC6, AC7)', () => {
  const cases: readonly [string, unknown, string][] = [
    ['EVM-040 AC7 a cancelled step-up is not confirmed', new StepUpCancelled(), 'notConfirmed'],
    ['EVM-040 AC7 a foreign error is a network failure', new Error('x'), 'network'],
    ['EVM-040 AC7 status 0 is a network failure', new ApiError(0, undefined), 'network'],
    ['EVM-040 AC6 412 is a conflict', new ApiError(412, { code: 'version_conflict' }), 'conflict'],
    ['EVM-040 AC6 428 is a conflict', new ApiError(428, { code: 'precondition_required' }), 'conflict'],
    ['EVM-040 AC7 404 is gone', new ApiError(404, { code: 'not_found' }), 'gone'],
    ['EVM-040 AC7 403 is forbidden', new ApiError(403, { code: 'forbidden' }), 'forbidden'],
    ['EVM-040 AC5 409 entry_is_event', new ApiError(409, { code: 'entry_is_event' }), 'event'],
    ['EVM-040 AC3 409 already_redacted', new ApiError(409, { code: 'already_redacted' }), 'alreadyRedacted'],
    ['EVM-040 AC3 503 deletion_register_unavailable', new ApiError(503, { code: 'deletion_register_unavailable' }), 'registerDown'],
    [
      'EVM-040 AC7 another 5xx is a server failure with the code to report, not a network one',
      new ApiError(500, { code: 'internal' }),
      'server',
    ],
    ['EVM-040 AC7 a 502 is a server failure too', new ApiError(502, undefined), 'server'],
    ['EVM-040 AC3 a 503 with another code is a server failure', new ApiError(503, { code: 'unavailable' }), 'server'],
  ];
  for (const [name, error, kind] of cases) {
    it(name, () => {
      expect(describeEraseFailure(error).kind).toBe(kind);
    });
  }

  it('EVM-040 AC7 an unknown 4xx carries the trace id or the code, and every failure has words with no entry text', () => {
    expect(describeEraseFailure(new ApiError(409, { code: 'other', traceId: 'abcdefghij' }))).toEqual({ kind: 'server', code: 'abcdefgh' });
    expect(describeEraseFailure(new ApiError(409, { code: 'other' }))).toEqual({ kind: 'server', code: 'other' });
    const t = ((key: string) => key) as never;
    for (const kind of ['conflict', 'gone', 'event', 'alreadyRedacted', 'registerDown', 'notConfirmed', 'forbidden', 'network'] as const) {
      expect(eraseFailureText(t, { kind })).toBe(`workOrder.journal.erase.failure.${kind}`);
    }
    expect(eraseFailureText(t, { kind: 'server', code: 'c' })).toBe('workOrder.journal.erase.failure.server');
  });
});

describe('replacement of a redacted entry in the cache (EVM-040 AC3)', () => {
  const entry = (id: string, body: string) => ({ id, body }) as unknown as TimelineEntry;
  it('EVM-040 AC3 replaces only the redacted entry and leaves other queries untouched', () => {
    const qc = new QueryClient();
    qc.setQueryData([WORK_ORDER_JOURNAL_KEY, 'wo'], {
      pageParams: [null],
      pages: [{ items: [entry('a', 'old'), entry('b', 'keep')], nextCursor: null }],
    });
    replaceEntryInCache(qc, 'wo', entry('a', 'marker'));
    const data = qc.getQueryData<{ pages: { items: TimelineEntry[] }[] }>([WORK_ORDER_JOURNAL_KEY, 'wo']);
    expect(data?.pages[0]?.items.map((i) => i.body)).toEqual(['marker', 'keep']);
    qc.setQueryData([WORK_ORDER_JOURNAL_KEY, 'wo', 'empty'], undefined);
    expect(() => {
      replaceEntryInCache(qc, 'wo', entry('a', 'marker'));
    }).not.toThrow();
  });
});
