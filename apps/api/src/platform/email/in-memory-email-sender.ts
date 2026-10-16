/** The fake of the port for the tests (EVM-024 AC6): messages are kept in memory; a test can make the next sends fail. Never wired by configuration. */
import type { OutgoingEmail } from './email-address.ts';
import type { EmailPermanentError, EmailTransientError } from './email-errors.ts';
import type { EmailSender } from './email-sender.ts';

type Failure = EmailTransientError | EmailPermanentError;

export class InMemoryEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  #failures: Failure[] = [];
  #failAll: Failure | undefined;

  /** The next `count` sends fail with `error` (each one consumes a failure). */
  failNext(error: Failure, count = 1): void {
    this.#failures = [...this.#failures, ...Array.from({ length: count }, () => error)];
  }

  /** Every send fails until {@link recover} (a service that is down). */
  failAll(error: Failure): void {
    this.#failAll = error;
  }

  recover(): void {
    this.#failAll = undefined;
    this.#failures = [];
  }

  send(email: OutgoingEmail): Promise<void> {
    const failure = this.#failAll ?? this.#failures.shift();
    if (failure !== undefined) return Promise.reject(failure);
    this.sent.push(email);
    return Promise.resolve();
  }
}
