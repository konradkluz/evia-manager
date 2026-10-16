/**
 * The e-mail address and the message as types of the domain (EVM-024 AC2; SR-INPUT-07, ASVS V1.3.11, CWE-93, CWE-116): the rules
 * that keep a header from being injected live HERE, in the type, not in an adapter — every adapter of the port (the SMTP transport
 * today, the provider of EVM-089 tomorrow) receives a value that cannot carry a line break, a second recipient or a quoted local
 * part. `parseEmailAddress` is the only way to obtain an {@link EmailAddress}; `createOutgoingEmail` the only way to an {@link OutgoingEmail}.
 *
 * Deliberately stricter than the address RFC 5322 allows: ASCII letters, digits and the unquoted "atom" characters in the local part,
 * a dotted ASCII host name after a single `@` — no quoted strings, comments, display names, address literals or non-ASCII
 * (an internationalised host name would have to be sent as punycode; an unusual address is refused, never rewritten). This also
 * avoids the quoted-local-part parsing defect of the SMTP library (GHSA-mm7p-fcc7-pg87).
 */
import { EmailPermanentError } from './email-errors.ts';

declare const addressBrand: unique symbol;
/** A normalised (NFC, trimmed, lower case) address that passed {@link parseEmailAddress}. */
export type EmailAddress = string & { readonly [addressBrand]: true };

const MAX_ADDRESS_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;
const MAX_LABEL_LENGTH = 63;
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** @returns the normalised address, or `undefined` when the text is not an address this system sends to */
export function parseEmailAddress(raw: string): EmailAddress | undefined {
  const address = raw.normalize('NFC').trim().toLowerCase();
  if (address.length < 3 || address.length > MAX_ADDRESS_LENGTH) return undefined;
  const parts = address.split('@');
  if (parts.length !== 2) return undefined;
  const [local = '', host = ''] = parts;
  if (local.length === 0 || local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) return undefined;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0 || label.length > MAX_LABEL_LENGTH || !HOST_LABEL.test(label))) {
    return undefined;
  }
  // the last label is a top-level domain: letters only, at least two (no `a@b.1`, no `a@1.2.3.4` address literal)
  if (!/^[a-z]{2,63}$/.test(labels.at(-1) ?? '')) return undefined;
  return address as EmailAddress;
}

const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_LENGTH = 10_000;

/** One message to ONE recipient: no cc, bcc, attachment or header of its own (W5). Never logged. */
export interface OutgoingEmail {
  readonly to: EmailAddress;
  /** Without a line break or a control character; the library encodes it (RFC 2047) when it holds Polish letters. */
  readonly subject: string;
  /** `text/plain` UTF-8: a fixed template filled with values from closed lists — no data of customers. */
  readonly text: string;
}

/** @throws EmailPermanentError `invalid_message` when the subject or the text breaks the rules (a defect of the template, not of the recipient) */
export function createOutgoingEmail(message: {
  readonly to: EmailAddress;
  readonly subject: string;
  readonly text: string;
}): OutgoingEmail {
  const { to, subject, text } = message;
  const subjectOk = subject.length >= 1 && subject.length <= MAX_SUBJECT_LENGTH && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(subject);
  // The text may hold line breaks (it is a body) but no NUL or other control character.
  const textOk = text.length >= 1 && text.length <= MAX_TEXT_LENGTH && !/[^\P{Cc}\n]/u.test(text);
  if (!subjectOk || !textOk) throw new EmailPermanentError('invalid_message');
  return Object.freeze({ to, subject, text });
}
