/**
 * The provider of staging and production: Scaleway Transactional Email over its HTTP API (EVM-089 AC1, AC2, AC4; ADR-0010, ADR-0018;
 * SR-API-13, SR-COMM-02, SR-INFRA-05, SR-LOG-02; CWE-918, CWE-798, CWE-532). The worker is the only process that builds it.
 *
 * Outbound traffic (the pattern of `pwned-passwords.ts`):
 * - the URL is a CONSTANT of this file (host, path, region) — no setting, no environment variable can change it; the production factory takes
 *   no `fetch` (only the factory of the tests does, and a test scans the sources for its use);
 * - `redirect: 'error'` (a 3xx is a failure, never followed), a timeout of 5 s, default TLS verification, no cookies and no referrer;
 * - the body of the answer is never read into a message, a log or an error (it may carry the address of the recipient): it is drained up to
 *   a limit and dropped.
 *
 * The key (`X-Auth-Token`) comes from the file of the secret (read by the configuration, EVM-089 B), is checked at the start for its format
 * (a UUID) and lives only in a private field: it is in no error, no log and no `cause`.
 *
 * What the message is made of (SR-INPUT-07, TM-80): the sender (`from`: the address of the configuration, a CONSTANT name), ONE `to` without a
 * name, the subject and the text of the fixed templates, the project. Nothing else comes from the data.
 *
 * Failures are mapped to the classes of `email-errors.ts` with a fixed code (AC4, SR-ERR-02): 400 and 422 (the provider refuses the message or
 * the recipient) are permanent; EVERYTHING else — the network, the timeout, a redirect, 429, 5xx and also 401 / 403 (a wrong key: retried with
 * growing breaks, then the row is `failed` and W-16 says "Nie wysłano"; the code `provider_auth` tells the runbook to rotate the key) — is transient.
 *
 * THE CLASS IS NOT EXPORTED: the only way to get the adapter is {@link createTemEmailSender}, which returns it wrapped in the guard of
 * recipients (AC2) — an adapter without the guard cannot be built.
 */
import { createOutgoingEmail, parseEmailAddress, type EmailAddress, type OutgoingEmail } from './email-address.ts';
import { EmailPermanentError, EmailTransientError } from './email-errors.ts';
import type { EmailSender } from './email-sender.ts';
import { GuardedEmailSender, type GuardObserver, type RecipientPolicy } from './guarded-email-sender.ts';

export const TEM_ENDPOINT = 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails';
export const TEM_TIMEOUT_MS = 5_000;
export const TEM_MAX_RESPONSE_BYTES = 64 * 1024;
/** The domain verified in TEM, the ONLY domain of the sender (the configuration compares it exactly, on a label boundary). */
export const TEM_SENDER_DOMAIN = 'panel.eviacharge.pl';
/** The display name of the sender: a constant, never from the data. */
export const TEM_SENDER_NAME = 'EVia Manager';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The part of `fetch` the adapter uses (a seam of the tests; the production factory does not accept it). */
export type TemFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface TemSenderOptions {
  /** The sender address (`From`), a normalised address on the verified domain (checked by the configuration). */
  readonly from: string;
  /** The key of the API (a UUID), from the file of the secret. */
  readonly apiKey: string;
  /** The project of Scaleway the domain belongs to (a UUID). */
  readonly projectId: string;
  readonly policy: RecipientPolicy;
  readonly observer?: GuardObserver;
}

/** Drains the body up to a limit and drops it. */
async function discard(response: Response, limit: number): Promise<void> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
      if (done) return;
      received += value?.byteLength ?? 0;
      if (received > limit) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // a broken body of an answer that was already received changes nothing for the outcome
  }
}

/** @returns the class and the fixed code for the status of an answer that was not a success — never its body */
export function mapTemStatus(status: number): EmailTransientError | EmailPermanentError {
  if (status === 400 || status === 422) return new EmailPermanentError('message_rejected');
  if (status === 401 || status === 403) return new EmailTransientError('provider_auth');
  if (status === 429 || status >= 500) return new EmailTransientError('temporary_refusal');
  return new EmailTransientError('send_failed');
}

/** @returns the class and the fixed code for a failure of the call — never its message, cause or stack */
export function mapTemFailure(error: unknown): EmailTransientError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  return new EmailTransientError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'connection_failed');
}

class TemEmailSender implements EmailSender {
  readonly #from: string;
  readonly #apiKey: string;
  readonly #projectId: string;
  readonly #fetch: TemFetch;

  /** @throws EmailPermanentError `misconfigured` — fail closed, without the value that was wrong */
  constructor(options: Pick<TemSenderOptions, 'from' | 'apiKey' | 'projectId'>, fetchImplementation: TemFetch) {
    if (parseEmailAddress(options.from) !== options.from || !UUID.test(options.apiKey) || !UUID.test(options.projectId)) {
      throw new EmailPermanentError('misconfigured');
    }
    this.#from = options.from;
    this.#apiKey = options.apiKey;
    this.#projectId = options.projectId;
    this.#fetch = fetchImplementation;
  }

  async send(email: OutgoingEmail): Promise<void> {
    // Defence in depth: the type of the port already guarantees this; a message forged around the type is still refused here.
    if (parseEmailAddress(email.to) !== email.to) throw new EmailPermanentError('invalid_message');
    createOutgoingEmail(email);
    const to: EmailAddress = email.to;
    let response: Response;
    try {
      response = await this.#fetch(TEM_ENDPOINT, {
        method: 'POST',
        headers: { 'X-Auth-Token': this.#apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          project_id: this.#projectId,
          from: { email: this.#from, name: TEM_SENDER_NAME },
          to: [{ email: to }],
          subject: email.subject,
          text: email.text,
        }),
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(TEM_TIMEOUT_MS),
      });
    } catch (error) {
      throw mapTemFailure(error);
    }
    await discard(response, TEM_MAX_RESPONSE_BYTES);
    if (!response.ok) throw mapTemStatus(response.status);
  }
}

/**
 * THE way to get the provider (the worker): the adapter, always wrapped in the guard of recipients. Uses the global `fetch`.
 * @throws EmailPermanentError `misconfigured` when the sender, the key or the project is malformed
 */
export function createTemEmailSender(options: TemSenderOptions): EmailSender {
  return new GuardedEmailSender(new TemEmailSender(options, (url, init) => fetch(url, init)), options.policy, options.observer);
}

/** For the tests ONLY (a test scans `src/` for any other use): the same guarded adapter over a fake `fetch`. */
export function createTemEmailSenderForTest(options: TemSenderOptions, fetchImplementation: TemFetch): EmailSender {
  return new GuardedEmailSender(new TemEmailSender(options, fetchImplementation), options.policy, options.observer);
}
