/**
 * The contract of the port `EmailSender` as one suite of tests (EVM-024 AC2, AC6; docs/backlog/M1/EVM-024 → notatka (a)): every adapter
 * of the port runs it — the SMTP transport to Mailpit here, the provider of staging (EVM-089) later — so the same rules hold for all:
 * a message arrives whole (Polish letters, the link intact), a failure is classified as transient or permanent with a FIXED code, and
 * nothing of the message, the address or the response of the server survives in the error (SR-LOG-02, CWE-532).
 */
import { describe, expect, it } from 'vitest';
import { createOutgoingEmail, parseEmailAddress, type EmailAddress } from '../../src/platform/email/email-address.ts';
import { EmailPermanentError, EmailTransientError } from '../../src/platform/email/email-errors.ts';
import type { EmailSender } from '../../src/platform/email/email-sender.ts';

export interface DeliveredEmail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly headers: ReadonlyMap<string, string>;
}

export interface EmailSenderHarness {
  readonly sender: EmailSender;
  delivered(): readonly DeliveredEmail[];
  /** The service stops answering (the connection fails). */
  makeUnavailable(): Promise<void>;
  /** The service asks to try later (a 4xx answer). */
  makeDeferring(): void;
  /** The service refuses the recipient (a 5xx answer). */
  makeRefusingRecipient(): void;
  stop(): Promise<void>;
}

const RECIPIENT = parseEmailAddress('anna.testowa@mailpit.localhost') as EmailAddress;
const LINK = 'https://panel.evia.test/activate#Zm9vYmFyMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODk';
const SUBJECT = 'EVia Manager: zaproszenie do panelu — zażółć gęślą jaźń';
const TEXT = `Dzień dobry,\n\nzaproszono Cię do panelu EVia Manager z rolą: Edytor.\n\n${LINK}\n\nLink jest jednorazowy i ważny 72 godziny.\n`;

const message = () => createOutgoingEmail({ to: RECIPIENT, subject: SUBJECT, text: TEXT });

/** Serialises the observable parts of a failure: what the logger or the queue would store of it. */
const observable = (error: unknown): string => JSON.stringify(error, Object.getOwnPropertyNames(error)) + ((error as Error).stack ?? '');

export function describeEmailSenderContract(name: string, create: () => Promise<EmailSenderHarness>): void {
  describe(`contract of the port EmailSender: ${name} (EVM-024 AC2, AC6)`, () => {
    it('EVM-024 AC6 a message arrives whole: one recipient, text/plain UTF-8, Polish letters in the subject and the text, the link untouched', async () => {
      const harness = await create();
      try {
        await harness.sender.send(message());
        const [delivered, ...rest] = harness.delivered();
        expect(rest).toEqual([]);
        expect(delivered?.to).toEqual([RECIPIENT]);
        expect(delivered?.subject).toBe(SUBJECT);
        expect(delivered?.text.replace(/\r\n/g, '\n')).toContain(`\n${LINK}\n`);
        expect(delivered?.text.replace(/\r\n/g, '\n').startsWith('Dzień dobry,')).toBe(true);
        expect(delivered?.headers.get('content-type')).toMatch(/^text\/plain; charset=utf-8/i);
        expect(delivered?.headers.get('content-transfer-encoding')).toMatch(/^(quoted-printable|base64)$/i);
      } finally {
        await harness.stop();
      }
    });

    it('EVM-024 AC2 only from, to, subject and text are in the message: no cc, bcc, reply-to, x-mailer or attachment', async () => {
      const harness = await create();
      try {
        await harness.sender.send(message());
        const headers = [...(harness.delivered()[0]?.headers.keys() ?? [])];
        expect(headers).not.toEqual(expect.arrayContaining(['cc', 'bcc', 'reply-to', 'x-mailer', 'list-unsubscribe']));
        expect(harness.delivered()[0]?.headers.get('content-type')).not.toMatch(/multipart/i);
      } finally {
        await harness.stop();
      }
    });

    it('EVM-024 AC5 a service that is down is a transient failure with a fixed code and nothing of the message in the error', async () => {
      const harness = await create();
      try {
        await harness.makeUnavailable();
        const failure = await harness.sender.send(message()).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(EmailTransientError);
        expect((failure as EmailTransientError).code).toMatch(/^(connection_failed|timeout|send_failed)$/);
        expect((failure as Error).message).toBe((failure as EmailTransientError).code);
        expect((failure as Error).cause).toBeUndefined();
        expect(observable(failure)).not.toMatch(/anna|zażółć|Dzień|activate|localhost:/);
      } finally {
        await harness.stop();
      }
    });

    it('EVM-024 AC5 an answer "try later" is transient, a refused recipient is permanent — each with a fixed code and no text of the server', async () => {
      const harness = await create();
      try {
        harness.makeDeferring();
        const deferred = await harness.sender.send(message()).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(deferred).toBeInstanceOf(EmailTransientError);
        expect((deferred as EmailTransientError).code).toBe('temporary_refusal');
        harness.makeRefusingRecipient();
        const refused = await harness.sender.send(message()).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(refused).toBeInstanceOf(EmailPermanentError);
        expect((refused as EmailPermanentError).code).toBe('recipient_rejected');
        for (const failure of [deferred, refused]) {
          expect((failure as Error).message).toBe((failure as EmailPermanentError).code);
          expect(observable(failure)).not.toMatch(/anna|no such recipient|try later|451|550/);
        }
        expect(harness.delivered()).toEqual([]);
      } finally {
        await harness.stop();
      }
    });

    it('EVM-024 AC2 a message forged around the type (a line break in the recipient, a second recipient) is refused before anything is sent', async () => {
      const harness = await create();
      try {
        for (const to of ['a@b.test\r\nBcc: victim@mailpit.localhost', 'a@b.test, c@d.test', '"a@b"@mailpit.localhost', 'a@b.test\0']) {
          const forged = { to, subject: SUBJECT, text: TEXT } as unknown as Parameters<EmailSender['send']>[0];
          const failure = await harness.sender.send(forged).then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(EmailPermanentError);
        }
        const subjectFailure = await harness.sender.send({ to: RECIPIENT, subject: 'one\r\nBcc: x@y.test', text: TEXT }).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(subjectFailure).toBeInstanceOf(EmailPermanentError);
        expect(harness.delivered()).toEqual([]);
      } finally {
        await harness.stop();
      }
    });
  });
}
