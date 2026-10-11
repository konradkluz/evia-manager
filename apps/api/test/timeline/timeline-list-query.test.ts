import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  filterPartsOf,
  parsePosition,
  positionParts,
  resolveTimelineListQuery,
} from '../../src/modules/timeline/domain/timeline-list-query.ts';

const ORDER = '0198b0a0-0000-7000-8000-000000000001';
const STAGE = '0198b0a0-0000-7000-8000-000000000002';

describe('the query of the journal (EVM-037 AC6; SR-INPUT-01, SR-API-02, SR-API-04)', () => {
  it('EVM-037 AC6 the defaults: no filter, 25 per page, no cursor', () => {
    expect(resolveTimelineListQuery.parse({})).toEqual({
      kind: undefined,
      eventGroup: undefined,
      procedureStageId: undefined,
      limit: DEFAULT_LIMIT,
      cursor: undefined,
    });
  });

  it('EVM-038 AC4 the group of events is read as it comes; a group outside the list and a group together with kind are refused', () => {
    expect(resolveTimelineListQuery.parse({ eventGroup: 'status_changes', procedureStageId: STAGE })).toMatchObject({
      eventGroup: 'status_changes',
      kind: undefined,
    });
    for (const query of [{ eventGroup: 'payments' }, { eventGroup: '' }, { eventGroup: 'status_changes', kind: 'note' }]) {
      expect(resolveTimelineListQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('EVM-037 AC6 the filters, the limit as text (a query string) and the cursor are read as they come', () => {
    expect(resolveTimelineListQuery.parse({ kind: 'comment', procedureStageId: STAGE, limit: '100', cursor: 'abc_-' })).toEqual({
      kind: 'comment',
      procedureStageId: STAGE,
      limit: 100,
      cursor: 'abc_-',
    });
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '1e2' },
    { limit: '' },
    { kind: 'event' },
    { procedureStageId: 'x' },
    { cursor: 'a b' },
    { cursor: 'a'.repeat(513) },
    { sort: 'createdAt' },
  ])('EVM-037 AC6 %j is refused', (query) => {
    expect(resolveTimelineListQuery.safeParse(query).success).toBe(false);
  });

  it('EVM-037 SR-API-04 the cursor is bound to the order and the filters — and not to the limit', () => {
    const base = { kind: undefined, eventGroup: undefined, procedureStageId: undefined, limit: 25, cursor: undefined } as const;
    expect(filterPartsOf(ORDER, base)).toEqual([ORDER, '', '', '']);
    expect(filterPartsOf(ORDER, { ...base, kind: 'note', procedureStageId: STAGE })).toEqual([ORDER, 'note', '', STAGE]);
    expect(filterPartsOf(ORDER, { ...base, eventGroup: 'status_changes' })).toEqual([ORDER, '', 'status_changes', '']);
    expect(filterPartsOf(ORDER, { ...base, limit: 100 })).toEqual(filterPartsOf(ORDER, base));
  });

  it('EVM-037 AC6 the position is the time of the server and the identifier of the last entry — and only that is read back', () => {
    const created = new Date('2026-10-11T08:00:00.000Z');
    const parts = positionParts({ id: ORDER, created_at: created });
    expect(parts).toEqual(['2026-10-11T08:00:00.000Z', ORDER]);
    expect(parsePosition(parts)).toEqual({ createdAt: created, id: ORDER });
    expect(parsePosition(['yesterday', ORDER])).toBeUndefined();
    expect(parsePosition(['2026-10-11T08:00:00.000Z', 'x'])).toBeUndefined();
    expect(parsePosition(['2026-10-11T08:00:00.000Z'])).toBeUndefined();
  });
});
