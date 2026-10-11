import type { CurrentSession, ProcedureList, TimelineEntry, TimelineEvent } from '@evia/contracts';
import { activeSessionApi } from './render.tsx';
import { ACTIVE_SESSION, json, parseBody, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { HEADER, ORDER_ID, workOrderRoutes } from './work-order-api.ts';

/** Synthetic data of the journal of the order ZL-2026-0042 (EVM-037): the clock of the tests stands at `NOW`. */
export const BASE = `/api/v1/work-orders/${ORDER_ID}`;
export const TIMELINE = `${BASE}/timeline`;
export const NOW = '2026-10-11T12:00:00.000Z';
export const ME = ACTIVE_SESSION.user.id;
export const STAGE_ID = '01968f3e-0000-7000-8000-0000000f0001';

export const PROCEDURES: ProcedureList = {
  items: [
    {
      id: '01968f3e-0000-7000-8000-0000000a0001',
      code: 'osd',
      name: 'Uzgodnienia z OSD',
      position: 1,
      progress: { done: 0, total: 1 },
      stages: [
        {
          id: STAGE_ID,
          code: 'conditions',
          name: 'Warunki przyłączenia',
          position: 1,
          status: 'todo',
          dueDate: null,
          overdue: false,
          responsibleUser: null,
          waitingOn: null,
          waitingParty: null,
          waitingSince: null,
          waitingDays: null,
          blockedReason: null,
          startedAt: null,
          completedOn: null,
          version: 1,
        },
      ],
    },
  ],
  openStageCount: 1,
};

/** An entry made `n` minutes before `NOW` (the newest has the smallest `n`); `extra` overrides any field. */
export function entry(n: number, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: `01968f3e-0000-7000-8000-00000b${String(n).padStart(6, '0')}`,
    kind: 'note',
    noteCategory: 'arrangement',
    body: `Wpis numer ${String(n)}`,
    procedureStageId: null,
    procedureStageName: null,
    author: { id: ME, displayName: 'Anna Testowa' },
    createdAt: new Date(Date.parse(NOW) - n * 60_000).toISOString(),
    origin: 'web',
    capturedAt: null,
    supersedesEntryId: null,
    supersededByEntryId: null,
    redactedAt: null,
    event: null,
    ...extra,
  };
}

/** An automatic entry (EVM-038): the event of an order or a stage, made by the actor of the change. */
export function eventEntry(n: number, event: Partial<TimelineEvent>, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return entry(n, {
    kind: 'event',
    noteCategory: null,
    body: null,
    origin: 'system',
    event: {
      code: 'stage_status_changed',
      objectType: 'procedure_stage',
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
      ...event,
    },
    ...extra,
  });
}

export const roleSession = (role: 'editor' | 'read_only'): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
});

/**
 * A stateful fake of the journal: it filters by `kind` and `procedureStageId`, pages with an opaque cursor and puts a created
 * entry on top (a correction also marks the replaced one). `post` replaces the answer of the creation.
 */
export function journalApi({
  entries,
  session = ACTIVE_SESSION,
  post,
  list,
  header,
}: {
  readonly entries: readonly TimelineEntry[];
  readonly session?: CurrentSession;
  readonly post?: Handler;
  readonly list?: Handler;
  readonly header?: Handler;
}) {
  const store = [...entries];
  const defaultList: Handler = (request) => {
    const group = request.query.get('eventGroup');
    const kind = group === 'status_changes' ? 'event' : request.query.get('kind');
    const stage = request.query.get('procedureStageId');
    const cursor = request.query.get('cursor');
    const limit = Number(request.query.get('limit') ?? '25');
    const all = store.filter((item) => (kind === null || item.kind === kind) && (stage === null || item.procedureStageId === stage));
    const start = cursor === null ? 0 : Number(cursor);
    const next = start + limit;
    return json(200, { items: all.slice(start, next), nextCursor: next < all.length ? String(next) : null });
  };
  const defaultPost: Handler = (request) => {
    const body = parseBody(request.body) as Record<string, unknown>;
    const created = entry(0, {
      id: String(body['id']),
      kind: body['kind'] === 'comment' ? 'comment' : 'note',
      noteCategory: body['kind'] === 'comment' ? null : ((body['noteCategory'] as TimelineEntry['noteCategory']) ?? null),
      body: String(body['body']),
      supersedesEntryId: typeof body['supersedesEntryId'] === 'string' ? body['supersedesEntryId'] : null,
      procedureStageId: typeof body['procedureStageId'] === 'string' ? body['procedureStageId'] : null,
      procedureStageName: typeof body['procedureStageId'] === 'string' ? 'Warunki przyłączenia' : null,
      createdAt: new Date(Date.parse(NOW) + 30_000).toISOString(),
    });
    const replaced = store.findIndex((item) => item.id === created.supersedesEntryId);
    const original = store[replaced];
    if (original !== undefined) store[replaced] = { ...original, supersededByEntryId: created.id };
    store.unshift(created);
    return json(201, created);
  };
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, {
      procedures: () => json(200, PROCEDURES),
      header: header ?? (() => json(200, { ...HEADER }, { ETag: '"3"' })),
    }),
    [`GET ${TIMELINE}`]: list ?? defaultList,
    [`POST ${TIMELINE}`]: post ?? defaultPost,
  });
}
