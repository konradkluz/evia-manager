/**
 * Errors of the port of sending an e-mail (EVM-024; SR-LOG-02, CWE-532, CWE-209): two kinds, each with a FIXED code and no text from the
 * driver — the response of a mail server carries the address of the recipient and a part of the message, and a job error is stored
 * by the queue and written to the log.
 * - transient: the service did not answer or asked to try later — the job is retried with growing breaks;
 * - permanent: the recipient or the message was refused — no retry, the row goes to `failed` at once.
 */
export const TRANSIENT_CODES = ['connection_failed', 'timeout', 'temporary_refusal', 'send_failed'] as const;
export const PERMANENT_CODES = [
  'recipient_rejected',
  'message_rejected',
  'recipient_not_allowed',
  'invalid_message',
  'misconfigured',
] as const;

export type TransientCode = (typeof TRANSIENT_CODES)[number];
export type PermanentCode = (typeof PERMANENT_CODES)[number];

export class EmailTransientError extends Error {
  readonly code: TransientCode;

  constructor(code: TransientCode) {
    super(code);
    this.name = 'EmailTransientError';
    this.code = code;
  }
}

export class EmailPermanentError extends Error {
  readonly code: PermanentCode;

  constructor(code: PermanentCode) {
    super(code);
    this.name = 'EmailPermanentError';
    this.code = code;
  }
}
