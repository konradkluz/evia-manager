/**
 * Model of the entry form (EVM-105 AC1-AC3): pure functions that turn what the technician typed into the command the queue stores.
 * Rules kept here (security plan of the story):
 * - the text is normalised like the server does (`normalizeEntryBody`: NFC, LF, control and direction characters removed, trimmed,
 *   at most 10 000 code points), so the length that is checked here is the length the server checks; the check is a convenience -
 *   the server stays the source of truth (a difference ends in "Wymaga uwagi");
 * - the stage goes into the command only when it belongs to THIS order (the server refuses a foreign one anyway);
 * - an error is a code, never the text (the text may name a person).
 */
import type { EnqueueInput } from '@evia/sync-core';
import type { OrderDetail } from './order-detail-model';

export const NOTE_CATEGORIES = ['phone_call', 'meeting', 'arrangement', 'site_visit', 'other'] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export const DEFAULT_CATEGORY: NoteCategory = 'other';
export type EntryKind = 'note' | 'comment';

/** The limit of the command (code points, after the normalisation). */
export const MAX_BODY_LENGTH = 10_000;

/** Every control character but the new line, the direction controls and the line and paragraph separators (as the server). */
const REMOVED = /(?!\n)\p{Cc}|[\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

export type BodyProblem = 'empty' | 'too_long' | 'invalid';
export type BodyResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly problem: BodyProblem };

function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function codePoints(text: string): number {
  let points = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) index += 1;
    points += 1;
  }
  return points;
}

/** The text as the server will store it, or the reason why it will not be accepted. */
export function normalizeBody(raw: string): BodyResult {
  if (!wellFormed(raw)) return { ok: false, problem: 'invalid' };
  const value = raw.normalize('NFC').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(REMOVED, '').trim();
  if (value === '') return { ok: false, problem: 'empty' };
  if (codePoints(value) > MAX_BODY_LENGTH) return { ok: false, problem: 'too_long' };
  return { ok: true, value };
}

/** A stage of the order for the optional choice (the stages of the details, in the order of the processes). */
export interface StageChoice {
  readonly id: string;
  readonly name: string;
  readonly process: string;
}

export function stageChoices(detail: Pick<OrderDetail, 'processes'>): StageChoice[] {
  return detail.processes.flatMap((process) => process.stages.map((stage) => ({ id: stage.id, name: stage.name, process: process.name })));
}

export interface EntryDraft {
  readonly kind: EntryKind;
  readonly workOrderId: string;
  readonly category: NoteCategory;
  /** The chosen stage; ignored unless it is in `stages`. */
  readonly stageId: string | null;
  readonly stages: readonly StageChoice[];
  readonly body: string;
}

export type BuildResult = { readonly ok: true; readonly input: EnqueueInput } | { readonly ok: false; readonly problem: BodyProblem };

/**
 * The command for the queue: `CreateNote` (category, optional stage) or `CreateComment` (neither); version 1; `capturedAt` is the time
 * on the phone (information only, SR-SYNC-05); the id is new for every save (a UUIDv7 from the CSPRNG of the session).
 */
export function buildEntryInput(draft: EntryDraft, now: number, newId: () => string): BuildResult {
  const body = normalizeBody(draft.body);
  if (!body.ok) return { ok: false, problem: body.problem };
  const base = { id: newId(), workOrderId: draft.workOrderId, body: body.value, capturedAt: new Date(now).toISOString() };
  if (draft.kind === 'comment') return { ok: true, input: { type: 'CreateComment', commandVersion: 1, payload: base } };
  const stage = draft.stageId !== null && draft.stages.some((choice) => choice.id === draft.stageId) ? draft.stageId : null;
  return {
    ok: true,
    input: {
      type: 'CreateNote',
      commandVersion: 1,
      payload: { ...base, noteCategory: draft.category, ...(stage === null ? {} : { procedureStageId: stage }) },
    },
  };
}
