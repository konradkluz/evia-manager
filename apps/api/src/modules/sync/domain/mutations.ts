/**
 * The push of mutations of the phone (EVM-098 AC1, AC4, AC7; ADR-0008; offline-sync.md rules 1, 4, 5; SR-SYNC-03, SR-SYNC-05, SR-SYNC-06, SR-INPUT-01). Pure,
 * no database. Two levels, checked apart:
 * - the ENVELOPE of the batch (`pendingItems`, 1–50 mutations, each with a `mutationId` that is a UUIDv7): a bad envelope is `400` for the whole batch, before
 *   anything is written - the rest of a mutation is not looked at here (the generated schema of the request is NOT used: it would turn a bad payload into a 400);
 * - ONE mutation (at most 64 KB, a known `type` and `commandVersion`, a payload of the strict schema of the contract): a bad one is `rejected
 *   validation_failed` of that mutation only. The text is measured by the rules of the journal (`timeline`), so the schema here only says it is a string.
 * The hash of a mutation is the SHA-256 of the canonical `{type, commandVersion, payload}` AS RECEIVED - before `capturedAt` is judged or the text normalised -
 * so a retry never becomes a mismatch when a rule of normalisation changes; `mutationId` and `pendingItems` are not part of it.
 */
import { zCreateCommentPayload, zCreateNotePayload, zSyncClientId } from '@evia/contracts/zod';
import { z } from 'zod';
import { strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';

export const MAX_MUTATIONS_PER_BATCH = 50;
export const MAX_MUTATION_BYTES = 64 * 1024;
export const MAX_PENDING_ITEMS = 1_000_000;
/** `capturedAt` is metadata: older than 60 days or later than the server time + 10 minutes is dropped with a warning (AC7). */
export const CAPTURED_AT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
export const CAPTURED_AT_MAX_AHEAD_MS = 10 * 60 * 1000;
/** The scope of the idempotency records of the push - shared by every command of the batch (EVM-099 adds `CreateQuickWorkOrder` under the same scope). */
export const SYNC_MUTATIONS_SCOPE = 'POST /api/v1/sync/mutations';

/** The commands served; `CreateQuickWorkOrder` is in the contract but not served before EVM-099 (`rejected validation_failed`, like an unknown type). */
export type CommandType = 'CreateNote' | 'CreateComment';

export const envelopeSchema = z.strictObject({
  pendingItems: z.int().min(0).max(MAX_PENDING_ITEMS).optional(),
  mutations: z
    .array(z.looseObject({ mutationId: zSyncClientId }))
    .min(1)
    .max(MAX_MUTATIONS_PER_BATCH),
});

export type Envelope = z.output<typeof envelopeSchema>;
export type RawMutation = Envelope['mutations'][number];

/** RFC 3339 with an offset (`Z` or `±hh:mm`); a local time without one is not a moment. */
const capturedAt = z.iso.datetime({ offset: true }).max(40);
const notePayload = strictObjects(zCreateNotePayload.extend({ body: z.string(), capturedAt }));
const commentPayload = strictObjects(zCreateCommentPayload.extend({ body: z.string(), capturedAt }));
const mutationShape = z.strictObject({ mutationId: zSyncClientId, type: z.string(), commandVersion: z.int(), payload: z.unknown() });

interface NotePayload {
  readonly id: string;
  readonly workOrderId: string;
  readonly noteCategory: 'phone_call' | 'meeting' | 'arrangement' | 'site_visit' | 'other';
  readonly body: string;
  readonly procedureStageId?: string | undefined;
  readonly capturedAt: string;
}
type CommentPayload = Omit<NotePayload, 'noteCategory' | 'procedureStageId'>;

/** A note or a comment ready for the journal: `capturedAt` is the moment in range or `null`. */
export interface EntryCommand {
  readonly id: string;
  readonly kind: 'note' | 'comment';
  readonly workOrderId: string;
  readonly noteCategory: NotePayload['noteCategory'] | undefined;
  readonly body: string;
  readonly procedureStageId: string | undefined;
  readonly capturedAt: Date | null;
}

export type DecodedMutation =
  | {
      readonly ok: true;
      readonly type: CommandType;
      readonly command: EntryCommand;
      readonly hash: string;
      readonly capturedAtOutOfRange: boolean;
    }
  | { readonly ok: false };

const INVALID: DecodedMutation = { ok: false };

/** Is `capturedAt` within [now − 60 days, now + 10 minutes] (both ends included)? */
export function capturedAtInRange(at: Date, now: Date): boolean {
  const time = at.getTime();
  return time >= now.getTime() - CAPTURED_AT_MAX_AGE_MS && time <= now.getTime() + CAPTURED_AT_MAX_AHEAD_MS;
}

/** One mutation of a valid envelope against the contract; `now` is the time of the server. Never a pointer or a value of the input in the answer. */
export function decodeMutation(raw: RawMutation, now: Date): DecodedMutation {
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_MUTATION_BYTES) return INVALID;
  const shape = mutationShape.safeParse(raw);
  if (!shape.success || shape.data.commandVersion !== 1) return INVALID;
  const { type, commandVersion, payload } = shape.data;
  const hash = requestHash({ type, commandVersion, payload });
  if (type === 'CreateNote') {
    const parsed = notePayload.safeParse(payload);
    if (!parsed.success) return INVALID;
    const note = parsed.data as NotePayload;
    return decoded(
      'CreateNote',
      { ...note, kind: 'note', noteCategory: note.noteCategory, procedureStageId: note.procedureStageId },
      hash,
      now,
    );
  }
  if (type === 'CreateComment') {
    const parsed = commentPayload.safeParse(payload);
    if (!parsed.success) return INVALID;
    const comment = parsed.data as CommentPayload;
    return decoded('CreateComment', { ...comment, kind: 'comment', noteCategory: undefined, procedureStageId: undefined }, hash, now);
  }
  return INVALID;
}

function decoded(
  type: CommandType,
  payload: Omit<EntryCommand, 'capturedAt'> & { readonly capturedAt: string },
  hash: string,
  now: Date,
): DecodedMutation {
  const at = new Date(payload.capturedAt);
  const inRange = capturedAtInRange(at, now);
  return {
    ok: true,
    type,
    hash,
    capturedAtOutOfRange: !inRange,
    command: {
      id: payload.id,
      kind: payload.kind,
      workOrderId: payload.workOrderId,
      noteCategory: payload.noteCategory,
      body: payload.body,
      procedureStageId: payload.procedureStageId,
      capturedAt: inRange ? at : null,
    },
  };
}

/** The result of one mutation (`SyncMutationResult` of the contract): a code and warnings only - never a pointer, a value or a field of an existing row. */
export interface MutationResult {
  readonly mutationId: string;
  readonly outcome: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  readonly code?:
    'id_conflict' | 'forbidden' | 'target_unavailable' | 'validation_failed' | 'idempotency_mismatch' | 'idempotency_in_progress';
  readonly warnings?: ReadonlyArray<'captured_at_out_of_range' | 'idempotency_expired'>;
}

export type MutationVerdict = Omit<MutationResult, 'mutationId'>;

/**
 * A result other than `applied` decided INSIDE the transaction of a mutation: thrown, not returned, so the transaction rolls back and the platform writes no
 * idempotency record (AC4: a record exists for `applied` only). The service catches exactly this type (and the two problems of the idempotency port).
 */
export class MutationVerdictSignal extends Error {
  readonly verdict: MutationVerdict;

  constructor(verdict: MutationVerdict) {
    super(`mutation ${verdict.outcome}`);
    this.name = 'MutationVerdictSignal';
    this.verdict = verdict;
  }
}

/** The label `type` of the metric: a closed list - the type comes from the client, an open label would let it multiply the series. */
export function typeLabel(raw: unknown): string {
  switch (raw) {
    case 'CreateNote':
      return 'create_note';
    case 'CreateComment':
      return 'create_comment';
    case 'CreateQuickWorkOrder':
      return 'create_quick_work_order';
    default:
      return 'unknown';
  }
}
