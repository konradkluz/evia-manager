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
import { zCreateCommentPayload, zCreateNotePayload, zCreateQuickWorkOrderPayload, zSyncClientId } from '@evia/contracts/zod';
import { z } from 'zod';
import { strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { Collector, type FieldIssue } from '../../../platform/input/field-issues.ts';

export const MAX_MUTATIONS_PER_BATCH = 50;
export const MAX_MUTATION_BYTES = 64 * 1024;
export const MAX_PENDING_ITEMS = 1_000_000;
/** `capturedAt` is metadata: older than 60 days or later than the server time + 10 minutes is dropped with a warning (AC7). */
export const CAPTURED_AT_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
export const CAPTURED_AT_MAX_AHEAD_MS = 10 * 60 * 1000;
/** The scope of the idempotency records of the push - shared by every command of the batch (EVM-099 adds `CreateQuickWorkOrder` under the same scope). */
export const SYNC_MUTATIONS_SCOPE = 'POST /api/v1/sync/mutations';

/** The commands served (EVM-099 added `CreateQuickWorkOrder`; its content is judged by {@link decodeQuickWorkOrder}). */
export type CommandType = 'CreateNote' | 'CreateComment' | 'CreateQuickWorkOrder';

/** The limit of the errors of a field in one result (the contract has `maxItems: 20`). */
export const MAX_FIELD_ERRORS = 20;
const MAX_POINTER_LENGTH = 128;

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

/** The new customer of a quick order, as the phone sent it (before the rules of `customers`). */
export interface QuickNewCustomer {
  readonly id: string;
  readonly kind: 'person' | 'company';
  readonly displayName: string;
  readonly phone: string;
}

/** The new site of a quick order, as the phone sent it (before the rules of `sites`). */
export interface QuickNewSite {
  readonly id: string;
  readonly siteType: 'single_family_house' | 'multi_family_garage' | 'commercial' | 'other';
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber?: string | undefined;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber?: string | undefined;
}

/** `CreateQuickWorkOrder` ready for the service: the title and the note are normalised; exactly one of each pair is set. */
export interface QuickCommand {
  readonly workOrderId: string;
  readonly templateId: string;
  readonly title: string;
  readonly customerId: string | undefined;
  readonly newCustomer: QuickNewCustomer | undefined;
  readonly siteId: string | undefined;
  readonly newSite: QuickNewSite | undefined;
  /** The customer and the site of the order: the existing ones or the new ones (exactly one of each pair is set, so there is always one). */
  readonly customerRef: string;
  readonly siteRef: string;
  /** `null` - no note (absent or blank). */
  readonly note: string | null;
  /** The same identifier twice in the command (the order, the new customer, the new site): `conflict id_conflict` without a write. */
  readonly duplicateIds: boolean;
}

export type DecodedMutation =
  | {
      readonly ok: true;
      readonly type: 'CreateNote' | 'CreateComment';
      readonly command: EntryCommand;
      readonly hash: string;
      readonly capturedAtOutOfRange: boolean;
    }
  | { readonly ok: true; readonly type: 'CreateQuickWorkOrder'; readonly quick: QuickCommand; readonly hash: string }
  /** `errors`: only for `CreateQuickWorkOrder` (AC5: the field and the code, never the value). */
  | { readonly ok: false; readonly errors?: readonly FieldIssue[] };

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
  if (!shape.success) return INVALID;
  const { type, commandVersion, payload } = shape.data;
  if (commandVersion !== 1) {
    return type === 'CreateQuickWorkOrder' ? { ok: false, errors: [{ pointer: '/commandVersion', code: 'unsupported_version' }] } : INVALID;
  }
  const hash = requestHash({ type, commandVersion, payload });
  if (type === 'CreateQuickWorkOrder') return decodeQuickWorkOrder(payload, hash);
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
  type: 'CreateNote' | 'CreateComment',
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
    | 'id_conflict'
    | 'forbidden'
    | 'target_unavailable'
    | 'validation_failed'
    | 'idempotency_mismatch'
    | 'idempotency_in_progress'
    | 'template_unavailable'
    | 'quota_exceeded';
  readonly warnings?: ReadonlyArray<'captured_at_out_of_range' | 'idempotency_expired'>;
  /** The number of the order: `applied` and `duplicate` of `CreateQuickWorkOrder` only (EVM-099 AC1, AC6). */
  readonly workOrderNumber?: string;
  /** The field errors of a `CreateQuickWorkOrder` that is `validation_failed`: a pointer and a code, never a value (EVM-099 AC5). */
  readonly errors?: readonly FieldIssue[];
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

/** The limit of new customers and of new sites a device may create in a rolling 24 hours (EVM-099 AC7): a constant of the code, not a setting. */
export const QUICK_CREATE_LIMIT = 20;
export const QUICK_CREATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The refusal by the limit: a {@link MutationVerdictSignal} that also says WHICH limit (`customer` | `site`), so the service can record it after the rollback. */
export class QuotaExceededSignal extends MutationVerdictSignal {
  readonly kind: 'customer' | 'site';

  constructor(kind: 'customer' | 'site') {
    super({ outcome: 'rejected', code: 'quota_exceeded' });
    this.kind = kind;
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

const quickPayload = strictObjects(zCreateQuickWorkOrderPayload);

/** `CreateQuickWorkOrder` against the strict schema of the contract and the rules the schema cannot state. Every error is a JSON Pointer and a code - never a value. */
function decodeQuickWorkOrder(payload: unknown, hash: string): DecodedMutation {
  const parsed = quickPayload.safeParse(payload);
  if (!parsed.success) return { ok: false, errors: capped(parsed.error.issues.map(issueOf)) };
  const input = parsed.data as {
    workOrderId: string;
    templateId: string;
    title: string;
    customerId?: string;
    newCustomer?: QuickNewCustomer;
    siteId?: string;
    newSite?: QuickNewSite;
    note?: string;
  };
  const rules = new Collector();
  const title = rules.required('/title', input.title, { maxLength: 200 });
  const note = rules.text('/note', input.note, { maxLength: 2000, multiline: true });
  if ((input.customerId === undefined) === (input.newCustomer === undefined)) rules.fail('/customerId', 'exactly_one_of');
  if ((input.siteId === undefined) === (input.newSite === undefined)) rules.fail('/siteId', 'exactly_one_of');
  if (rules.errors.length > 0 || title === null) return { ok: false, errors: capped(rules.errors) };
  const ids = [input.workOrderId, input.newCustomer?.id, input.newSite?.id].filter((id) => id !== undefined);
  return {
    ok: true,
    type: 'CreateQuickWorkOrder',
    hash,
    quick: {
      workOrderId: input.workOrderId,
      templateId: input.templateId,
      title,
      customerId: input.customerId,
      newCustomer: input.newCustomer,
      siteId: input.siteId,
      newSite: input.newSite,
      customerRef: (input.customerId ?? input.newCustomer?.id) as string,
      siteRef: (input.siteId ?? input.newSite?.id) as string,
      note,
      duplicateIds: new Set(ids).size !== ids.length,
    },
  };
}

/** One issue of the schema as a pointer and a code: the message and the received value of the issue are NEVER used (the payload holds a name, a telephone, an address). */
function issueOf(issue: z.core.$ZodIssue): FieldIssue {
  const pointer = `/${issue.path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
  return { pointer: (pointer === '/' ? '' : pointer).slice(0, MAX_POINTER_LENGTH), code: codeOf(issue.code) };
}

function codeOf(code: z.core.$ZodIssue['code']): string {
  switch (code) {
    case 'unrecognized_keys':
      return 'unknown_field';
    case 'too_small':
      return 'too_short';
    case 'too_big':
      return 'too_long';
    case 'invalid_format':
      return 'invalid_format';
    case 'invalid_value':
      return 'invalid_value';
    default:
      return 'invalid_type';
  }
}

/** At most {@link MAX_FIELD_ERRORS} different errors (the contract's `maxItems`). */
export function capped(issues: readonly FieldIssue[]): FieldIssue[] {
  const seen = new Set<string>();
  const out: FieldIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.pointer}#${issue.code}`;
    if (seen.has(key) || out.length >= MAX_FIELD_ERRORS) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
