/**
 * The input of an invitation (EVM-024 AC1, AC2; SR-INPUT-01, SR-INPUT-07): the shape comes from the schema of the contract (strict — an
 * unknown field is `unknown_field`); the rules of the domain are checked here and answered as a pointer and a code, never the value:
 * the address is the type of the platform (`parseEmailAddress`: no CR/LF/NUL, no quoted part, one `@`) — `invalid_email`; the name is plain
 * text, NFC, trimmed, 1–200 characters without control or formatting characters (it ends up in the body of a message and in the
 * list of users, never in a header or a subject) — `required`, `too_long`, `invalid_characters`.
 */
import { parseEmailAddress, type EmailAddress } from '../../../platform/email/email-address.ts';
import type { FieldError } from '../../../platform/http/problem.ts';

export const DISPLAY_NAME_MAX_LENGTH = 200;

export type InvitableRole = 'administrator' | 'editor' | 'read_only';

export interface InvitationInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: InvitableRole;
}

export interface NewInvitation {
  readonly id: string;
  readonly email: EmailAddress;
  readonly displayName: string;
  readonly role: InvitableRole;
}

export type InvitationResult =
  { readonly ok: true; readonly invitation: NewInvitation } | { readonly ok: false; readonly errors: readonly FieldError[] };

/** Characters that are not text of a name: controls (line breaks included), formatting (zero-width, bidi), line and paragraph separators. */
const NOT_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** @returns the normalised invitation, or the errors of the fields (pointer and code) */
export function normalizeInvitation(input: InvitationInput): InvitationResult {
  const errors: FieldError[] = [];

  const email = parseEmailAddress(input.email);
  if (email === undefined) errors.push({ pointer: '/email', code: 'invalid_email' });

  const displayName = input.displayName.normalize('NFC').trim();
  if (displayName.length === 0) errors.push({ pointer: '/displayName', code: 'required' });
  else if (Array.from(displayName).length > DISPLAY_NAME_MAX_LENGTH) errors.push({ pointer: '/displayName', code: 'too_long' });
  else if (NOT_TEXT.test(displayName)) errors.push({ pointer: '/displayName', code: 'invalid_characters' });

  if (errors.length > 0 || email === undefined) return { ok: false, errors };
  return { ok: true, invitation: { id: input.id, email, displayName, role: input.role } };
}
