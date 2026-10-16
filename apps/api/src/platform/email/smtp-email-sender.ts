/**
 * The SMTP transport of the port (EVM-024 AC6; ADR-0010) — the ONLY file that imports the library (dependency-cruiser,
 * `api-smtp-only-in-email-adapter`), wired by the composition root of the worker only. In this story it talks to Mailpit in the
 * development environment; the configuration refuses any other host (`EMAIL_SMTP_HOST`), so mail cannot leave the machine
 * through it. The provider of staging and production is another adapter (EVM-089), wrapped in `GuardedEmailSender`.
 *
 * What the message is made of (W5; SR-API-13, CWE-918, CWE-73): `from`, ONE `to`, `subject` and `text` — nothing else comes from the
 * data (no cc, bcc, attachment, header, list, alternative, icalendar). The library may read neither files nor URLs
 * (`disableFileAccess`, `disableUrlAccess`), uses no proxy and no connection URL, and its logger is OFF: the logger of the library
 * dumps the transcript of the session — the link with the token included. A failure is mapped to a class with a fixed code
 * BEFORE it can reach a job error or a log (the response of the server carries the address and a part of the message).
 */
import { createTransport, type Transporter } from 'nodemailer';
import { createOutgoingEmail, parseEmailAddress, type OutgoingEmail } from './email-address.ts';
import { EmailPermanentError, EmailTransientError } from './email-errors.ts';
import type { EmailSender } from './email-sender.ts';

/** Every limit of time is below the expiry of a job of the queue (15 minutes) and below what a person waits for (W5: at most 10 s). */
export const SMTP_TIMEOUT_MS = 10_000;

export interface SmtpEmailSenderOptions {
  readonly host: string;
  readonly port: number;
  /** The sender address (`From`): a validated address of the configuration. */
  readonly from: string;
}

interface DriverFailure {
  readonly code?: unknown;
  readonly responseCode?: unknown;
}

/** @returns the class and the fixed code for a failure of the driver — never its message, response, command, envelope or cause */
export function mapSmtpFailure(error: unknown): EmailTransientError | EmailPermanentError {
  const failure: DriverFailure = typeof error === 'object' && error !== null ? error : {};
  const code = typeof failure.code === 'string' ? failure.code : '';
  const status = typeof failure.responseCode === 'number' ? failure.responseCode : 0;
  if (status >= 500 && status < 600) return new EmailPermanentError(code === 'EENVELOPE' ? 'recipient_rejected' : 'message_rejected');
  if (status >= 400 && status < 500) return new EmailTransientError('temporary_refusal');
  if (code === 'EENVELOPE') return new EmailPermanentError('recipient_rejected');
  if (code === 'EMESSAGE') return new EmailPermanentError('message_rejected');
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT') return new EmailTransientError('timeout');
  if (['ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) {
    return new EmailTransientError('connection_failed');
  }
  return new EmailTransientError('send_failed');
}

export class SmtpEmailSender implements EmailSender {
  readonly #from: string;
  readonly #transport: Transporter;

  /** @throws EmailPermanentError `misconfigured` — fail closed: a transport without a host, a port or a sender is never built */
  constructor(options: SmtpEmailSenderOptions) {
    if (options.host === '' || options.from === '' || !Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
      throw new EmailPermanentError('misconfigured');
    }
    this.#from = options.from;
    this.#transport = createTransport({
      host: options.host,
      port: options.port,
      secure: false,
      // Mailpit speaks plain SMTP on the loopback of the development machine; the host list of the configuration keeps it there.
      ignoreTLS: true,
      name: 'evia-worker',
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
      dnsTimeout: SMTP_TIMEOUT_MS,
      allowInternalNetworkInterfaces: true,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    // Defence in depth: the type of the port already guarantees this; a message forged around the type is still refused here.
    if (parseEmailAddress(email.to) !== email.to) throw new EmailPermanentError('invalid_message');
    createOutgoingEmail(email);
    try {
      await this.#transport.sendMail({ from: this.#from, to: email.to, subject: email.subject, text: email.text });
    } catch (error) {
      throw mapSmtpFailure(error);
    }
  }

  /** Releases the connections (the shutdown of the worker). */
  close(): void {
    this.#transport.close();
  }
}
