/**
 * The rules of the metadata of a NEW medium, the same for the batch of the panel and for the command `CreateMediaAsset` of the phone (EVM-131 AC3; SR-INPUT-01, SR-INPUT-02): the category
 * is from the closed list and the description is plain text (NFC, trimmed, line breaks allowed, no control characters, at most 1000 characters; empty means none). One function, so the two
 * entrances cannot drift. The stage of the order is checked by the caller (it needs the database); the order and the creator come from the session, never from the request.
 */
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { MEDIA_DESCRIPTION_MAX, normaliseDescription } from './metadata-patch.ts';

export const MEDIA_CATEGORIES = ['site_survey', 'before_work', 'in_progress', 'completed_work', 'defect', 'measurement', 'other'] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export interface NewMediaMetadata {
  readonly category: string;
  readonly description?: string | null | undefined;
}

export type ResolvedMediaMetadata =
  | { readonly ok: true; readonly category: MediaCategory; readonly description: string | null }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

export function resolveNewMediaMetadata(input: NewMediaMetadata): ResolvedMediaMetadata {
  const issues: FieldIssue[] = [];
  if (!(MEDIA_CATEGORIES as readonly string[]).includes(input.category)) issues.push({ pointer: '/category', code: 'invalid_value' });
  const description = normaliseDescription(input.description, MEDIA_DESCRIPTION_MAX);
  if (!description.ok) issues.push(description.issue);
  if (issues.length > 0 || !description.ok) return { ok: false, issues };
  return { ok: true, category: input.category as MediaCategory, description: description.value ?? null };
}
