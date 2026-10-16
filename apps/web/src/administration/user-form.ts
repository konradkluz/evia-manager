import type { UserRole } from '@evia/contracts';
import type { TFunction } from 'i18next';
import type { ApiError } from '../api/client.ts';

/** The form "Zaproś użytkownika" (EVM-024 AC1, AC2): what the person typed, as it is typed. */
export interface InviteForm {
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
}

export type InviteField = 'email' | 'displayName' | 'role';
export type InviteErrors = Partial<Record<InviteField, string>>;

/** The default role of an invitation is Edytor (flows/12, dialog 1). */
export const EMPTY_INVITE: InviteForm = { email: '', displayName: '', role: 'editor' };
export const INVITE_FIELDS: readonly InviteField[] = ['email', 'displayName', 'role'];

/**
 * A first look at the address before anything is sent: one `@`, text on both sides and nothing a header could be built from
 * (blanks, quotes, `<>,;`). The server decides (`400 validation_failed`, SR-INPUT-07) — this only saves a round trip.
 */
const ADDRESS_SHAPE = /^[^\s@<>,;"]+@[^\s@<>,;"]+$/u;

export const isAddressShaped = (email: string): boolean => ADDRESS_SHAPE.test(email.trim());

/** The body of the request: trimmed text, the identifier of the new account named by the panel (UUIDv7). */
export function buildInviteBody(form: InviteForm, id: string) {
  return { id, email: form.email.trim(), displayName: form.displayName.trim(), role: form.role };
}

/** The fields that cannot be sent as they are (the codes the server would answer: `required`, `invalid_email`). */
export function checkInvite(form: InviteForm): readonly { readonly field: InviteField; readonly code: string }[] {
  const problems: { field: InviteField; code: string }[] = [];
  if (!isAddressShaped(form.email)) problems.push({ field: 'email', code: 'invalid_email' });
  if (form.displayName.trim() === '') problems.push({ field: 'displayName', code: 'required' });
  return problems;
}

/** The text under a field for a code of the API (the server never sends the value — SR-ERR-02). */
export function inviteErrorText(t: TFunction, field: InviteField, code: string): string {
  switch (field) {
    case 'email':
      return t('users.errors.email');
    case 'displayName':
      if (code === 'required') return t('users.errors.displayNameRequired');
      if (code === 'too_long') return t('users.errors.displayNameTooLong');
      if (code === 'invalid_characters') return t('users.errors.displayNameInvalid');
      return t('users.errors.invalid');
    case 'role':
      return t('users.errors.role');
  }
}

/** The field a pointer of the server names (`/email`), or `undefined` for one the form does not have. */
export function fieldOfPointer(pointer: string): InviteField | undefined {
  return INVITE_FIELDS.find((field) => pointer === `/${field}`);
}

/** The errors of a `400` of the server, one per field (the first code wins). */
export function fieldErrorsOf(t: TFunction, error: ApiError): InviteErrors {
  const found: InviteErrors = {};
  for (const entry of error.errors) {
    const field = fieldOfPointer(entry.pointer);
    if (field !== undefined && found[field] === undefined) found[field] = inviteErrorText(t, field, entry.code);
  }
  return found;
}

export const firstInvalid = (errors: InviteErrors): InviteField | undefined => INVITE_FIELDS.find((field) => errors[field] !== undefined);
