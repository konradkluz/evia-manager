/**
 * The edit of the metadata of a medium or a document (EVM-048; SR-INPUT-05, SR-AUTHZ-04): pure functions, no framework. A patch names only what the
 * client wants to change (a merge-patch: `null` clears the description and the stage); here it is normalised (plain text: NFC, trimmed, no control
 * or invisible characters, a new line only in a description) and reduced to the REAL change - what differs from the current values - so a request
 * that changes nothing is recognised (`200` without a new version and without an audit event).
 */
import { plainText } from '../../../platform/input/plain-text.ts';

export interface FieldIssue {
  readonly pointer: string;
  readonly code: string;
}

export const MEDIA_DESCRIPTION_MAX = 1000;
export const DOCUMENT_DESCRIPTION_MAX = 2000;
export const DOCUMENT_TITLE_MAX = 200;

/** @returns the normalised description (`null` = none: an explicit `null` and a text that is empty after trimming mean the same) or the issue */
export function normaliseDescription(
  raw: string | null | undefined,
  maxLength: number,
): { readonly ok: true; readonly value: string | null | undefined } | { readonly ok: false; readonly issue: FieldIssue } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  const text = plainText(raw, { maxLength, multiline: true });
  if (!text.ok) return { ok: false, issue: { pointer: '/description', code: text.code } };
  return { ok: true, value: text.value ?? null };
}

/** @returns the normalised title (a title that is empty after trimming is `required`) or the issue */
export function normaliseTitle(
  raw: string | undefined,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly issue: FieldIssue } {
  if (raw === undefined) return { ok: true, value: undefined };
  const text = plainText(raw, { maxLength: DOCUMENT_TITLE_MAX });
  if (!text.ok) return { ok: false, issue: { pointer: '/title', code: text.code } };
  if (text.value === undefined) return { ok: false, issue: { pointer: '/title', code: 'required' } };
  return { ok: true, value: text.value };
}

/** Keeps only the entries of `change` whose value differs from the current one; `undefined` entries (not named in the patch) are never kept. */
export function realChange<T extends object>(change: T, current: { readonly [K in keyof T]-?: unknown }): Partial<T> {
  const entries = Object.entries(change).filter(
    ([key, value]) => value !== undefined && value !== (current as Record<string, unknown>)[key],
  );
  return Object.fromEntries(entries) as Partial<T>;
}

/** A change that touches nothing. */
export const isEmpty = (change: object): boolean => Object.keys(change).length === 0;
