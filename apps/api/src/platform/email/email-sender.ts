/**
 * The port of sending an e-mail (EVM-024; ADR-0010) and its error contract. An adapter (the SMTP transport to Mailpit, the in-memory
 * fake of the tests, the provider of EVM-089) implements `EmailSender`; the job that sends (`send-email.job.ts`) knows nothing else.
 *
 * The failures it raises are the two classes of `email-errors.ts`, each with a fixed code and no text of the driver.
 */
import type { OutgoingEmail } from './email-address.ts';

export interface EmailSender {
  /**
   * @throws EmailTransientError (email-errors.ts) the service is unavailable or asked to try later
   * @throws EmailPermanentError (email-errors.ts) the recipient or the message was refused
   */
  send(email: OutgoingEmail): Promise<void>;
}
