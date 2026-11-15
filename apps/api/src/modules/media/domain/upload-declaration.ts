/**
 * The declaration of a file inside the upload session of a medium that has none yet (EVM-131; SR-FILE-01, SR-FILE-03, CWE-434): the medium was created on the phone, so the type, the size, the
 * checksum and the name arrive now. The same rules as the batch of the panel (`checkDeclaration`: the allow-list, the extension that matches the type, 50 MB / 4 GiB) plus: the type of the
 * file belongs to the KIND of the medium (a photo takes no video). Pure; pointers are `/file/...`, codes from the dictionary of the batch (never a value).
 */
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { checkDeclaration, type CheckedDeclaration } from './file-rules.ts';

export interface FileDeclaration {
  readonly fileName: string;
  readonly declaredSize: number;
  readonly contentType: string;
  readonly sha256: string;
}

export function checkSessionDeclaration(
  file: FileDeclaration,
  mediaType: 'photo' | 'video',
): { readonly ok: true; readonly value: CheckedDeclaration } | { readonly ok: false; readonly issues: readonly FieldIssue[] } {
  const checked = checkDeclaration(file);
  if (!checked.ok) return { ok: false, issues: checked.issues.map((issue) => ({ pointer: `/file/${issue.field}`, code: issue.code })) };
  if (checked.value.mediaType !== mediaType) return { ok: false, issues: [{ pointer: '/file/contentType', code: 'unsupported_type' }] };
  return checked;
}

/** The stored declaration of a file, as far as a repeat of the request compares it (the name is the cleaned one). */
export interface StoredDeclaration {
  readonly declaredSize: number;
  readonly declaredContentType: string;
  readonly declaredSha256: string;
  readonly originalFilename: string | null;
}

/** Is `file` (already checked) the declaration the medium has? A repeat after a lost answer is; a different one never replaces it (SR-FILE-01). */
export const sameDeclaration = (file: FileDeclaration, checked: CheckedDeclaration, stored: StoredDeclaration): boolean =>
  stored.declaredSize === file.declaredSize &&
  stored.declaredContentType === checked.contentType &&
  stored.declaredSha256 === file.sha256 &&
  stored.originalFilename === checked.originalFilename;
