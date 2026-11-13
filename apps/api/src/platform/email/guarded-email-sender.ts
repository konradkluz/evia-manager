/**
 * The guard of the recipients of an EXTERNAL provider (EVM-024 AC6, EVM-089 AC2; SR-API-13, SR-INPUT-07; docs/ux/flows/e-maile.md, rule 13).
 * The decorator decides, before the provider is asked, whether a message may leave the environment at all:
 * - an address on a domain reserved for documentation and tests (RFC 2606, RFC 6761: `example.com`, `example.net`, `example.org` and their
 *   subdomains, the top-level domains `.test`, `.example`, `.invalid`, `.localhost`) is INTERCEPTED in every mode — synthetic data never
 *   sends mail, a mistake in a fixture can never cost the reputation of the sender;
 * - mode `lista` (the default, fail closed): only an address of the list passes; an empty list intercepts everything;
 * - mode `otwarty`: every other address passes (a deliberate change of the configuration on the VM, never of the repository).
 *
 * "Intercepted" means the message goes NOWHERE and the job still succeeds (the row is `sent`, no retry, no error): the log says only the id of
 * the row, the kind and the reason (a closed list), the counter has the reason as its only label — never an address, a domain or a text
 * (SR-LOG-02). The adapter of a provider is always wrapped in it (`tem-email-sender.ts` builds nothing else); Mailpit and the in-memory fake
 * are not (nothing leaves the machine).
 */
import type { Logger } from '../logging/logger.ts';
import type { Counter } from '../metrics/metrics.ts';
import { parseEmailAddress, type EmailAddress, type OutgoingEmail } from './email-address.ts';
import { EmailPermanentError } from './email-errors.ts';
import type { EmailSendContext, EmailSender } from './email-sender.ts';

const RESERVED_DOMAINS: readonly string[] = ['example.com', 'example.net', 'example.org'];
const RESERVED_TOP_LEVEL: readonly string[] = ['test', 'example', 'invalid', 'localhost'];

/** @param address a normalised address (lower case) */
export function isReservedRecipient(address: string): boolean {
  const host = address.slice(address.lastIndexOf('@') + 1);
  const topLevel = host.slice(host.lastIndexOf('.') + 1);
  return RESERVED_TOP_LEVEL.includes(topLevel) || RESERVED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export const RECIPIENT_MODES = ['lista', 'otwarty'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];

/** The closed list of the reasons of an interception (the value of the only label of the counter). */
export type InterceptReason = 'reserved_domain' | 'not_on_list';

export const INTERCEPTED_METRIC = 'email_intercepted_total';

/** Fail closed: anything but the exact word `otwarty` (a missing, empty or unknown value) is `lista`. */
export function parseRecipientMode(raw: string | undefined): RecipientMode {
  return raw?.trim().toLowerCase() === 'otwarty' ? 'otwarty' : 'lista';
}

export interface RecipientPolicy {
  readonly mode: RecipientMode;
  /** Normalised addresses (`parseEmailAddress`); consulted in the mode `lista` only. */
  readonly allowed: ReadonlySet<string>;
}

export interface GuardObserver {
  readonly logger?: Logger;
  readonly intercepted?: Counter;
}

export class GuardedEmailSender implements EmailSender {
  readonly #inner: EmailSender;
  readonly #mode: RecipientMode;
  readonly #allowed: ReadonlySet<string>;
  readonly #observer: GuardObserver;

  /** Without a policy the guard is the strictest one: mode `lista` and an empty list (everything is intercepted). */
  constructor(inner: EmailSender, policy: RecipientPolicy = { mode: 'lista', allowed: new Set() }, observer: GuardObserver = {}) {
    this.#inner = inner;
    this.#mode = policy.mode;
    this.#allowed = new Set(policy.allowed);
    this.#observer = observer;
  }

  send(email: OutgoingEmail, context?: EmailSendContext): Promise<void> {
    // A message forged around the type is a defect, not something to intercept quietly: it fails loudly (the reserved-domain test below reads the host).
    if (parseEmailAddress(email.to) !== email.to) return Promise.reject(new EmailPermanentError('invalid_message'));
    const reason = this.#reasonToIntercept(email.to);
    if (reason === undefined) return this.#inner.send(email, context);
    this.#observer.logger?.info({ outboxId: context?.outboxId, kind: context?.kind, reason }, 'email: intercepted');
    this.#observer.intercepted?.increment({ reason });
    return Promise.resolve();
  }

  #reasonToIntercept(to: EmailAddress): InterceptReason | undefined {
    if (isReservedRecipient(to)) return 'reserved_domain';
    if (this.#mode === 'lista' && !this.#allowed.has(to)) return 'not_on_list';
    return undefined;
  }
}
