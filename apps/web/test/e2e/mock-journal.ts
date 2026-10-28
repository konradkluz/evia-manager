import type { Answer } from './mock-locations.ts';
import { PROCESSES, processCountOf, stageId, type OrderServer } from './mock-procedures.ts';

/**
 * The part of the synthetic API that serves the journal of an order (EVM-037): the list with the filters and the cursor, and the
 * creation with the rules of the real answers that the browser can feel — the role (`403`), a missing order (`404`), the text
 * (`required`, `too_long`), a stage of another order (`400 /procedureStageId`), a correction of an entry that was already corrected
 * (`409 entry_superseded`), the idempotency (the same key and body replay the entry, another body is `422`), a taken `id`
 * (`409 id_conflict`). Synthetic data only; the full stack (the database, the policies, the audit, the append-only trigger) is
 * covered by the API integration tests.
 */
/** The structured event of an automatic entry (EVM-038): what the server sends in `event`; the party carries its CURRENT name and kind. */
export interface JournalEventRecord {
  readonly code: string;
  readonly objectType: 'work_order' | 'procedure_stage';
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly waitingOn: 'customer' | 'party' | null;
  readonly waitingOnParty: { readonly id: string; readonly name: string | null; readonly kind: string | null } | null;
  readonly changedFields: readonly string[];
}

export interface JournalRecord {
  readonly id: string;
  readonly kind: 'note' | 'comment' | 'event';
  readonly event?: JournalEventRecord;
  readonly noteCategory: string | null;
  readonly body: string;
  readonly procedureStageId: string | null;
  readonly authorId: string;
  readonly createdAt: string;
  readonly supersedesEntryId: string | null;
  /** EVM-040: set by a delete (soft) and a redaction; the version rises with each of them. */
  readonly deletedAt?: string | null;
  readonly redactedAt?: string | null;
  readonly version?: number;
}

export interface JournalServer {
  /** The entries of every order, newest first. */
  readonly entries: Map<string, JournalRecord[]>;
  /** `orderId|Idempotency-Key` → the raw body and the entry that was created. */
  readonly keys: Map<string, { readonly raw: string; readonly entryId: string }>;
}

export const newJournalServer = (): JournalServer => ({ entries: new Map(), keys: new Map() });

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789', ...extra });

const fieldError = (pointer: string, code: string): Answer => problem(400, 'validation_failed', { errors: [{ pointer, code }] });

/** The stages of an order made from a template: the same ones the list of processes shows. */
function stagesOf(orders: OrderServer, orderId: string): Map<string, string> {
  const created = orders.created.find((entry) => entry.id === orderId);
  const found = new Map<string, string>();
  if (created === undefined || created.templateId === null) return found;
  const count = processCountOf(orders.templates.find((entry) => entry.id === created.templateId)?.items.length ?? 0);
  PROCESSES.slice(0, count).forEach((process, processIndex) => {
    process.stages.forEach((name, stageIndex) => {
      found.set(stageId(orderId, processIndex + 1, stageIndex + 1), name);
    });
  });
  return found;
}

const exists = (orders: OrderServer, orderId: string): boolean =>
  orders.created.some((entry) => entry.id === orderId) && !orders.gone.has(orderId);

export function represent(server: JournalServer, orders: OrderServer, orderId: string, record: JournalRecord) {
  const author = orders.assignable.find((entry) => entry.id === record.authorId);
  const stages = stagesOf(orders, orderId);
  const replacement = (server.entries.get(orderId) ?? []).find((entry) => entry.supersedesEntryId === record.id);
  return {
    id: record.id,
    kind: record.kind,
    noteCategory: record.noteCategory,
    body: record.kind === 'event' ? null : record.body,
    procedureStageId: record.procedureStageId,
    procedureStageName: record.procedureStageId === null ? null : (stages.get(record.procedureStageId) ?? null),
    author: author === undefined ? null : { id: author.id, displayName: author.displayName },
    createdAt: record.createdAt,
    origin: record.kind === 'event' ? 'system' : 'web',
    capturedAt: null,
    supersedesEntryId: record.supersedesEntryId,
    supersededByEntryId: replacement?.id ?? null,
    redactedAt: record.redactedAt ?? null,
    deletedAt: record.deletedAt ?? null,
    event: record.event ?? null,
  };
}

/** `GET /work-orders/{id}/timeline`: the filters in the query, the newest first, the opaque cursor (an offset here). */
export function answerJournalList(server: JournalServer, orders: OrderServer, orderId: string, query: URLSearchParams): Answer {
  if (!exists(orders, orderId)) return problem(404, 'not_found');
  const group = query.get('eventGroup');
  if (group !== null && group !== 'status_changes') return problem(400, 'validation_failed');
  if (group !== null && query.has('kind')) return problem(400, 'validation_failed');
  const kind = group === null ? query.get('kind') : 'event';
  const stage = query.get('procedureStageId');
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? '25')));
  const cursor = query.get('cursor');
  const start = cursor === null ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0) return problem(400, 'invalid_cursor');
  const withDeleted = query.get('includeDeleted') === 'true';
  const all = (server.entries.get(orderId) ?? []).filter(
    (entry) =>
      (kind === null || entry.kind === kind) &&
      (stage === null || entry.procedureStageId === stage) &&
      (withDeleted || (entry.deletedAt ?? null) === null),
  );
  const next = start + limit;
  return json(200, {
    items: all.slice(start, next).map((entry) => represent(server, orders, orderId, entry)),
    nextCursor: next < all.length ? String(next) : null,
  });
}

interface CreateInput {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly userId: string;
  readonly key: string | undefined;
  readonly raw: string;
}

const LIMIT = 10_000;
const CATEGORIES = ['phone_call', 'meeting', 'arrangement', 'site_visit', 'other'];

/** `POST /work-orders/{id}/timeline`: role, the order, the key, the text, the stage, the corrected entry, the idempotency, the insert. */
export function answerJournalCreate(server: JournalServer, orders: OrderServer, orderId: string, input: CreateInput): Answer {
  if (input.role === 'read_only') return problem(403, 'forbidden');
  if (!exists(orders, orderId)) return problem(404, 'not_found');
  if (input.key === undefined) return fieldError('/headers/Idempotency-Key', 'required');
  const body = JSON.parse(input.raw) as Record<string, unknown>;
  const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
  if (text === '') return fieldError('/body', 'required');
  if (Array.from(text).length > LIMIT) return fieldError('/body', 'too_long');
  const kind = body['kind'];
  if (kind !== 'note' && kind !== 'comment') return fieldError('/kind', 'invalid_value');
  const category = body['noteCategory'];
  if (kind === 'note' && (typeof category !== 'string' || !CATEGORIES.includes(category))) return fieldError('/noteCategory', 'required');
  if (kind === 'comment' && category !== undefined) return fieldError('/noteCategory', 'not_allowed');

  const scoped = `${orderId}|${input.key}`;
  const seen = server.keys.get(scoped);
  if (seen !== undefined) {
    if (seen.raw !== input.raw) return problem(422, 'idempotency_mismatch');
    const record = (server.entries.get(orderId) ?? []).find((entry) => entry.id === seen.entryId);
    return record === undefined
      ? problem(404, 'not_found')
      : json(201, represent(server, orders, orderId, record), { 'Idempotent-Replayed': 'true' });
  }
  const id = String(body['id']);
  if ([...server.entries.values()].some((list) => list.some((entry) => entry.id === id))) return problem(409, 'id_conflict');

  const stage = body['procedureStageId'];
  if (typeof stage === 'string' && !stagesOf(orders, orderId).has(stage)) return fieldError('/procedureStageId', 'unknown_stage');
  const list = server.entries.get(orderId) ?? [];
  const supersedes = body['supersedesEntryId'];
  let inherited: string | null = null;
  if (typeof supersedes === 'string') {
    const original = list.find((entry) => entry.id === supersedes);
    if (original === undefined || original.kind !== kind) return fieldError('/supersedesEntryId', 'unknown_entry');
    if (list.some((entry) => entry.supersedesEntryId === original.id)) return problem(409, 'entry_superseded');
    inherited = original.procedureStageId;
  }
  const record: JournalRecord = {
    id,
    kind,
    noteCategory: kind === 'note' ? String(category) : null,
    body: text,
    procedureStageId: typeof stage === 'string' ? stage : stage === null ? null : inherited,
    authorId: input.userId,
    createdAt: new Date().toISOString(),
    supersedesEntryId: typeof supersedes === 'string' ? supersedes : null,
  };
  server.entries.set(orderId, [record, ...list]);
  server.keys.set(scoped, { raw: input.raw, entryId: id });
  return json(201, represent(server, orders, orderId, record), { Location: `/api/v1/work-orders/${orderId}/timeline/${id}` });
}

/** For the specs: `count` entries of an order, the newest first, one every 30 minutes before now; `body(n)` is the text of the n-th. */
export function seedJournal(
  server: JournalServer,
  orderId: string,
  count: number,
  body: (n: number) => string = (n) => `Wpis numer ${String(n)}`,
): void {
  server.entries.set(
    orderId,
    Array.from({ length: count }, (_unused, index) => ({
      id: `01968f3e-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
      kind: (index + 1) % 5 === 0 ? ('comment' as const) : ('note' as const),
      noteCategory: (index + 1) % 5 === 0 ? null : 'arrangement',
      body: body(index + 1),
      procedureStageId: null,
      authorId: '11111111-1111-4111-8111-111111111111',
      createdAt: new Date(Date.now() - (index + 1) * 30 * 60_000).toISOString(),
      supersedesEntryId: null,
    })),
  );
}

/**
 * For the specs (EVM-038): the automatic entries of an order, newest first, made by the author of the seed: the creation, a stage that
 * waits for a party (the name and the kind of the party are current data), a stage that is done, the order put on hold, the change of
 * the person and the date. `stage` is the id of a stage of the order.
 */
export function seedEvents(server: JournalServer, orderId: string, stage: string, party: { id: string; name: string; kind: string }): void {
  const base = { noteCategory: null, body: '', authorId: '11111111-1111-4111-8111-111111111111', supersedesEntryId: null } as const;
  const event = (index: number, minutes: number, procedureStageId: string | null, data: Partial<JournalEventRecord>): JournalRecord => ({
    ...base,
    id: `01968f3e-0000-7000-8000-0000000e${String(index).padStart(4, '0')}`,
    kind: 'event',
    procedureStageId,
    createdAt: new Date(Date.now() - minutes * 60_000).toISOString(),
    event: {
      code: 'stage_status_changed',
      objectType: procedureStageId === null ? 'work_order' : 'procedure_stage',
      fromStatus: null,
      toStatus: null,
      waitingOn: null,
      waitingOnParty: null,
      changedFields: [],
      ...data,
    },
  });
  server.entries.set(orderId, [
    event(1, 5, stage, { toStatus: 'waiting', fromStatus: 'in_progress', waitingOn: 'party', waitingOnParty: party }),
    event(2, 15, stage, { code: 'stage_updated', changedFields: ['responsibleUserId', 'dueDate'] }),
    event(3, 25, stage, { toStatus: 'in_progress', fromStatus: 'todo' }),
    event(4, 35, null, { code: 'work_order_status_changed', fromStatus: 'new', toStatus: 'on_hold' }),
    event(5, 45, null, { code: 'work_order_created' }),
    ...(server.entries.get(orderId) ?? []),
  ]);
}
