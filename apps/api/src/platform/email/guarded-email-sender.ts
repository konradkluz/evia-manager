/**
 * The guard of the recipients of an EXTERNAL provider (EVM-024 AC6; SR-API-13; docs/ux/flows/e-maile.md, rule 13): the decorator
 * refuses, before the provider is asked, every address on a domain reserved for documentation and tests (RFC 2606, RFC 6761):
 * `example.com`, `example.net`, `example.org` (and their subdomains) and the top-level domains `.test`, `.example`, `.invalid`,
 * `.localhost`. A mistake in a fixture can then never send a real message — and cost the reputation of the sender — to a
 * made-up address. The adapter of a provider (EVM-089) is always wrapped in it; Mailpit and the in-memory fake are not (nothing
 * leaves the machine).
 */
import type { OutgoingEmail } from './email-address.ts';
import { EmailPermanentError } from './email-errors.ts';
import type { EmailSender } from './email-sender.ts';

const RESERVED_DOMAINS: readonly string[] = ['example.com', 'example.net', 'example.org'];
const RESERVED_TOP_LEVEL: readonly string[] = ['test', 'example', 'invalid', 'localhost'];

/** @param address a normalised address (lower case) */
export function isReservedRecipient(address: string): boolean {
  const host = address.slice(address.lastIndexOf('@') + 1);
  const topLevel = host.slice(host.lastIndexOf('.') + 1);
  return RESERVED_TOP_LEVEL.includes(topLevel) || RESERVED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export class GuardedEmailSender implements EmailSender {
  readonly #inner: EmailSender;

  constructor(inner: EmailSender) {
    this.#inner = inner;
  }

  send(email: OutgoingEmail): Promise<void> {
    if (isReservedRecipient(email.to)) return Promise.reject(new EmailPermanentError('recipient_not_allowed'));
    return this.#inner.send(email);
  }
}
