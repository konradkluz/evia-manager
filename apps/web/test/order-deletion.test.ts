import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { describeDeletionFailure, etagOfVersion } from '../src/work-orders/order-deletion.ts';

const failure = (status: number, code?: string, retry?: number, traceId?: string) =>
  describeDeletionFailure(
    new ApiError(status, code === undefined ? undefined : { code, ...(traceId === undefined ? {} : { traceId }) }, retry),
  );

describe('what the API says about deleting and restoring an order (EVM-060 AC2, AC3, AC5, AC6)', () => {
  it('EVM-060 AC2 409 has_active_dependents is "dependents", an answer in progress is "inProgress", another 409 is a server error', () => {
    expect(failure(409, 'has_active_dependents')).toEqual({ kind: 'dependents' });
    expect(failure(409, 'idempotency_in_progress')).toEqual({ kind: 'inProgress' });
    expect(failure(409, 'something_else', undefined, 'abcdef0123456789').kind).toBe('server');
  });

  it('EVM-060 AC3 403 step_up_required is told apart from a plain 403 (the first opens W-04, the second does not)', () => {
    expect(failure(403, 'step_up_required')).toEqual({ kind: 'stepUp' });
    expect(failure(403, 'forbidden')).toEqual({ kind: 'forbidden' });
    expect(failure(403, 'channel_not_allowed')).toEqual({ kind: 'forbidden' });
  });

  it('EVM-060 AC6 412 is a conflict, 404 is gone, 429 carries the seconds (60 by default), no answer and 5xx are the network', () => {
    expect(failure(412, 'version_conflict')).toEqual({ kind: 'conflict' });
    expect(failure(404, 'not_found')).toEqual({ kind: 'gone' });
    expect(failure(429, 'rate_limited', 30)).toEqual({ kind: 'rate', seconds: 30 });
    expect(failure(429, 'rate_limited')).toEqual({ kind: 'rate', seconds: 60 });
    expect(failure(0)).toEqual({ kind: 'network' });
    expect(failure(503, 'unavailable')).toEqual({ kind: 'network' });
    expect(describeDeletionFailure(new Error('boom'))).toEqual({ kind: 'network' });
  });

  it('EVM-060 AC6 a refused key is repaired by a retry; anything else shows the first 8 characters of the trace, or the code', () => {
    expect(failure(422, 'idempotency_mismatch')).toEqual({ kind: 'network' });
    expect(failure(418, 'teapot', undefined, 'abcdef0123456789')).toEqual({ kind: 'server', code: 'abcdef01' });
    expect(failure(418, 'teapot')).toEqual({ kind: 'server', code: 'teapot' });
  });

  it('EVM-060 AC1 the If-Match is the strong ETag of the version on screen', () => {
    expect(etagOfVersion(3)).toBe('"3"');
  });
});
