import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zCreateTimelineEntryHeaders,
  zCreateTimelineEntryRequest,
  zGetTimelineEntryPath,
  zListTimelineEntriesPath,
  zListTimelineEntriesQuery,
  zTimelineEntry,
  zTimelineEntryList,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const USER = '0198b0a0-0000-7000-8000-000000000002';
const entry = {
  id: V7,
  kind: 'note',
  noteCategory: 'phone_call',
  body: 'Rozmowa z klientem (tekst syntetyczny).',
  procedureStageId: null,
  procedureStageName: null,
  author: { id: USER, displayName: 'Anna Testowa' },
  createdAt: '2026-10-11T08:00:00.000Z',
  origin: 'web',
  capturedAt: null,
  supersedesEntryId: null,
  supersededByEntryId: null,
  redactedAt: null,
  event: null,
};

describe('timeline contract (EVM-037; SR-AUTHZ-01, SR-AUTHZ-04, SR-INPUT-01, SR-API-02, SR-DATA-03)', () => {
  it('EVM-037 AC8 the read is open to the three roles, the write to Administrator and Editor with audit — all on the web channel only', () => {
    for (const id of ['listTimelineEntries', 'getTimelineEntry']) {
      expect(AUTHZ_MANIFEST[id]?.authz, id).toMatchObject({ roles: ['administrator', 'editor', 'read_only'], channels: ['web'] });
    }
    expect(AUTHZ_MANIFEST['createTimelineEntry']).toMatchObject({
      method: 'post',
      path: '/api/v1/work-orders/{workOrderId}/timeline',
      authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
    });
  });

  it('EVM-037 AC3 an entry has no operation that changes or removes it: only list, get and create exist under the timeline', () => {
    const operations = Object.values(AUTHZ_MANIFEST)
      .filter((operation) => operation.path.includes('/timeline'))
      .map((operation) => `${operation.method} ${operation.path}`)
      .sort();
    expect(operations).toEqual([
      'get /api/v1/work-orders/{workOrderId}/timeline',
      'get /api/v1/work-orders/{workOrderId}/timeline/{entryId}',
      'post /api/v1/work-orders/{workOrderId}/timeline',
    ]);
  });

  it('EVM-037 AC7 an entry is addressed by the order AND the entry in the path', () => {
    expect(zGetTimelineEntryPath.safeParse({ workOrderId: V7, entryId: V7 }).success).toBe(true);
    expect(zGetTimelineEntryPath.safeParse({ workOrderId: V7, entryId: 'x' }).success).toBe(false);
    expect(zGetTimelineEntryPath.safeParse({ workOrderId: 'x', entryId: V7 }).success).toBe(false);
    expect(zListTimelineEntriesPath.safeParse({ workOrderId: 'x' }).success).toBe(false);
  });

  it('EVM-037 AC5 the create needs a UUIDv7 Idempotency-Key', () => {
    expect(zCreateTimelineEntryHeaders.safeParse({ 'Idempotency-Key': V7 }).success).toBe(true);
    expect(zCreateTimelineEntryHeaders.safeParse({}).success).toBe(false);
    expect(zCreateTimelineEntryHeaders.safeParse({ 'Idempotency-Key': 'abc' }).success).toBe(false);
  });

  it('EVM-037 AC1 AC2 the request takes id, kind, body, optional category, stage and correction target — never kind event', () => {
    const request = { id: V7, kind: 'note', noteCategory: 'phone_call', body: 'Tekst', procedureStageId: V7 };
    expect(zCreateTimelineEntryRequest.safeParse(request).success).toBe(true);
    expect(zCreateTimelineEntryRequest.safeParse({ id: V7, kind: 'comment', body: 'Tekst', supersedesEntryId: V7 }).success).toBe(true);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, procedureStageId: null }).success).toBe(true);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, kind: 'event' }).success).toBe(false);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, noteCategory: 'unknown' }).success).toBe(false);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, id: 'x' }).success).toBe(false);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, body: 'a'.repeat(10001) }).success).toBe(false);
    expect(zCreateTimelineEntryRequest.safeParse({ ...request, body: 'a'.repeat(10000) }).success).toBe(true);
    for (const field of ['author', 'createdAt', 'origin', 'capturedAt', 'supersededByEntryId', 'redactedAt', 'version', 'workOrderId']) {
      expect(Object.keys(zCreateTimelineEntryRequest.shape), field).not.toContain(field);
    }
  });

  it('EVM-037 AC6 SR-API-02 the query takes kind, stage, limit 1..100 and a cursor; the page is bounded at 100', () => {
    expect(zListTimelineEntriesQuery.parse({}).limit).toBe(25);
    expect(zListTimelineEntriesQuery.safeParse({ kind: 'comment', procedureStageId: V7, limit: 100, cursor: 'abc_-' }).success).toBe(true);
    expect(zListTimelineEntriesQuery.safeParse({ kind: 'event' }).success).toBe(false);
    expect(zListTimelineEntriesQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(zListTimelineEntriesQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(zTimelineEntryList.safeParse({ items: Array.from({ length: 101 }, () => entry), nextCursor: null }).success).toBe(false);
    expect(zTimelineEntryList.safeParse({ items: [entry], nextCursor: null }).success).toBe(true);
  });

  it('EVM-037 SR-DATA-03 the author is id and displayName only; an event has no body and no author', () => {
    expect(zTimelineEntry.safeParse(entry).success).toBe(true);
    const parsed = zTimelineEntry.parse({ ...entry, author: { id: USER, displayName: 'A', email: 'a@example.invalid' } });
    expect(parsed.author).toEqual({ id: USER, displayName: 'A' });
    expect(
      zTimelineEntry.safeParse({ ...entry, kind: 'event', noteCategory: null, body: null, author: null, origin: 'system' }).success,
    ).toBe(true);
    expect(Object.keys(zTimelineEntry.shape)).not.toContain('workOrderId');
  });

  it('EVM-038 AC3 an event carries its code, the statuses, who is waited for (id, current name and kind) and the names of the changed fields', () => {
    const event = {
      code: 'stage_status_changed',
      objectType: 'procedure_stage',
      fromStatus: 'in_progress',
      toStatus: 'waiting',
      waitingOn: 'party',
      waitingOnParty: { id: V7, name: 'Operator Testowy', kind: 'osd' },
      changedFields: [],
    };
    const row = {
      ...entry,
      kind: 'event',
      noteCategory: null,
      body: null,
      author: { id: USER, displayName: 'Anna Testowa' },
      origin: 'system',
      event,
    };
    expect(zTimelineEntry.parse(row).event).toEqual(event);
    expect(zTimelineEntry.parse({ ...row, event: { ...event, extra: 'x' } }).event).toEqual(event);
    expect(zTimelineEntry.safeParse({ ...row, event: { ...event, waitingOnParty: { id: V7, name: null, kind: null } } }).success).toBe(
      true,
    );
    expect(zTimelineEntry.safeParse({ ...row, event: undefined }).success).toBe(false);
  });

  it('EVM-038 AC4 EVM-054 AC3 the query takes the groups status_changes and payments; a value outside the list is refused', () => {
    expect(zListTimelineEntriesQuery.safeParse({ eventGroup: 'status_changes' }).success).toBe(true);
    expect(zListTimelineEntriesQuery.safeParse({ eventGroup: 'payments' }).success).toBe(true);
    expect(zListTimelineEntriesQuery.safeParse({ eventGroup: 'media' }).success).toBe(false);
  });

  it('EVM-038 AC6 AC7 SR-AUTHZ-05 the manifest is unchanged: the three roles read the journal on the web channel, no operation creates an event', () => {
    expect(AUTHZ_MANIFEST['listTimelineEntries']?.authz).toMatchObject({
      roles: ['administrator', 'editor', 'read_only'],
      channels: ['web'],
    });
    expect(zCreateTimelineEntryRequest.safeParse({ id: V7, kind: 'event', body: 'x' }).success).toBe(false);
  });
});
