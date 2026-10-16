import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createOutgoingEmail, parseEmailAddress, type EmailAddress } from '../../src/platform/email/email-address.ts';
import { EmailPermanentError, EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { GuardedEmailSender, isReservedRecipient } from '../../src/platform/email/guarded-email-sender.ts';
import { InMemoryEmailSender } from '../../src/platform/email/in-memory-email-sender.ts';
import { SmtpEmailSender, mapSmtpFailure } from '../../src/platform/email/smtp-email-sender.ts';
import { describeEmailSenderContract, type EmailSenderHarness } from '../support/email-sender-contract.ts';
import { startSmtpTestServer } from '../support/smtp-test-server.ts';

const address = (value: string): EmailAddress => parseEmailAddress(value) as EmailAddress;

describe('the e-mail address as a type of the domain (EVM-024 AC2; SR-INPUT-07)', () => {
  it('EVM-024 AC2 an address is normalised: NFC, trimmed, lower case', () => {
    expect(parseEmailAddress('  Anna.Testowa@Example.COM ')).toBe('anna.testowa@example.com');
    expect(parseEmailAddress("o'brien+evm@firma.example.pl")).toBe("o'brien+evm@firma.example.pl");
  });

  it('EVM-024 AC2 W7 CR, LF, NUL, a quoted part, a second recipient, a second @ and formatting characters are refused', () => {
    const refused = [
      'a@b.test\r\nBcc: victim@evil.test',
      'a@b.test\nBcc: victim@evil.test',
      'a@b.test\0',
      '"a@b"@example.com',
      '"anna"@example.com',
      'a@b@example.com',
      'a@example.com, b@example.com',
      'a@example.com;b@example.com',
      'Anna <a@example.com>',
      'a@example.com>',
      'a b@example.com',
      'a\u200b@example.com',
      'a\u202e@example.com',
      '@example.com',
      'a@',
      'a@example',
      'a@.example.com',
      'a@example..com',
      'a@-example.com',
      'a@example.c',
      'a@1.2.3.4',
      'a@[127.0.0.1]',
      '.a@example.com',
      'a..b@example.com',
      'zażółć@example.com',
      'a@zażółć.pl',
      '',
      'x'.repeat(65) + '@example.com',
      `a@${'x'.repeat(250)}.com`,
    ];
    for (const value of refused) expect(parseEmailAddress(value), JSON.stringify(value)).toBeUndefined();
  });

  it('EVM-024 AC2 a message has one recipient, a subject without a line break and a text without control characters', () => {
    const to = address('anna@example.com');
    expect(createOutgoingEmail({ to, subject: 'Zaproszenie', text: 'a\nb' })).toEqual({ to, subject: 'Zaproszenie', text: 'a\nb' });
    for (const [subject, text] of [
      ['one\r\ntwo', 'x'],
      ['one\ntwo', 'x'],
      ['a\0b', 'x'],
      ['a\u200bb', 'x'],
      ['a\u2028b', 'x'],
      ['', 'x'],
      ['x'.repeat(201), 'x'],
      ['ok', ''],
      ['ok', 'a\0b'],
      ['ok', 'a\rb'],
      ['ok', 'x'.repeat(10_001)],
    ] as const) {
      expect(() => createOutgoingEmail({ to, subject, text }), JSON.stringify([subject, text.slice(0, 8)])).toThrow(EmailPermanentError);
    }
  });

  it('EVM-024 AC2 the message is frozen: an adapter cannot change what was composed', () => {
    const message = createOutgoingEmail({ to: address('a@example.com'), subject: 's', text: 't' });
    expect(Object.isFrozen(message)).toBe(true);
  });
});

describe('the guard of the recipients of an external provider (EVM-024 AC6; SR-API-13)', () => {
  const message = (to: string) => createOutgoingEmail({ to: address(to), subject: 's', text: 't' });

  it('EVM-024 AC6 the adapter of a provider refuses example.com and .test (and the other names reserved by RFC 2606 and RFC 6761)', async () => {
    const provider = new InMemoryEmailSender();
    const guarded = new GuardedEmailSender(provider);
    for (const to of [
      'a@example.com',
      'a@mail.example.com',
      'a@example.net',
      'a@example.org',
      'a@firma.test',
      'a@x.y.test',
      'a@firma.example',
      'a@firma.invalid',
      'a@firma.localhost',
    ]) {
      const failure = await guarded.send(message(to)).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure, to).toBeInstanceOf(EmailPermanentError);
      expect((failure as EmailPermanentError).code).toBe('recipient_not_allowed');
    }
    expect(provider.sent).toEqual([]);
  });

  it('EVM-024 AC6 a real domain passes the guard — also one that merely ends like a reserved one', async () => {
    const provider = new InMemoryEmailSender();
    const guarded = new GuardedEmailSender(provider);
    for (const to of ['a@evia.pl', 'a@notexample.com', 'a@example.com.pl', 'a@contest.pl', 'a@attest.com']) {
      await guarded.send(message(to));
    }
    expect(provider.sent.map((sent) => sent.to)).toEqual([
      'a@evia.pl',
      'a@notexample.com',
      'a@example.com.pl',
      'a@contest.pl',
      'a@attest.com',
    ]);
    expect(isReservedRecipient('a@example.com')).toBe(true);
  });
});

describe('the fake of the port (EVM-024 AC6)', () => {
  const message = createOutgoingEmail({ to: address('a@example.com'), subject: 's', text: 't' });

  it('EVM-024 AC6 messages are kept in memory; failures are consumed one by one; recover clears them', async () => {
    const fake = new InMemoryEmailSender();
    fake.failNext(new EmailTransientError('timeout'), 2);
    await expect(fake.send(message)).rejects.toBeInstanceOf(EmailTransientError);
    await expect(fake.send(message)).rejects.toBeInstanceOf(EmailTransientError);
    await fake.send(message);
    expect(fake.sent).toHaveLength(1);
    fake.failAll(new EmailPermanentError('message_rejected'));
    await expect(fake.send(message)).rejects.toBeInstanceOf(EmailPermanentError);
    await expect(fake.send(message)).rejects.toBeInstanceOf(EmailPermanentError);
    fake.recover();
    await fake.send(message);
    expect(fake.sent).toHaveLength(2);
  });
});

describe('the SMTP adapter (EVM-024 AC6; W5)', () => {
  it('EVM-024 AC6 fail closed: a transport without a host, a port or a sender is never built', () => {
    for (const options of [
      { host: '', port: 1025, from: 'EVia <noreply@evia.pl>' },
      { host: 'mailpit', port: 0, from: 'EVia <noreply@evia.pl>' },
      { host: 'mailpit', port: 70_000, from: 'EVia <noreply@evia.pl>' },
      { host: 'mailpit', port: 1.5, from: 'EVia <noreply@evia.pl>' },
      { host: 'mailpit', port: 1025, from: '' },
    ]) {
      expect(() => new SmtpEmailSender(options)).toThrow(EmailPermanentError);
    }
  });

  it('EVM-024 AC5 W3 a failure of the driver is mapped to a class with a fixed code, whatever the driver says', () => {
    const mapped = (failure: object) => {
      const error = mapSmtpFailure(failure);
      return [error.name, error.code];
    };
    expect(mapped({ code: 'EENVELOPE', responseCode: 550, response: '550 anna@example.com unknown' })).toEqual([
      'EmailPermanentError',
      'recipient_rejected',
    ]);
    expect(mapped({ code: 'EENVELOPE' })).toEqual(['EmailPermanentError', 'recipient_rejected']);
    expect(mapped({ code: 'EMESSAGE', responseCode: 554 })).toEqual(['EmailPermanentError', 'message_rejected']);
    expect(mapped({ code: 'EMESSAGE' })).toEqual(['EmailPermanentError', 'message_rejected']);
    expect(mapped({ responseCode: 452 })).toEqual(['EmailTransientError', 'temporary_refusal']);
    expect(mapped({ code: 'ETIMEDOUT' })).toEqual(['EmailTransientError', 'timeout']);
    expect(mapped({ code: 'ETIMEOUT' })).toEqual(['EmailTransientError', 'timeout']);
    expect(mapped({ code: 'ECONNECTION' })).toEqual(['EmailTransientError', 'connection_failed']);
    expect(mapped({ code: 'ESOCKET' })).toEqual(['EmailTransientError', 'connection_failed']);
    expect(mapped({ code: 'EAUTH' })).toEqual(['EmailTransientError', 'send_failed']);
    expect(mapped({})).toEqual(['EmailTransientError', 'send_failed']);
    expect(mapSmtpFailure('a string')).toBeInstanceOf(EmailTransientError);
    expect(mapSmtpFailure(null)).toBeInstanceOf(EmailTransientError);
    expect(mapSmtpFailure({ code: 'EENVELOPE', responseCode: 550, response: 'secret', command: 'RCPT TO:<x@y>' })).not.toHaveProperty(
      'cause',
    );
  });

  it('EVM-024 AC6 a message to a refusing server leaves nothing in the log of the library (its logger is off) and the sender exposes close', async () => {
    const server = await startSmtpTestServer();
    const sender = new SmtpEmailSender({ host: '127.0.0.1', port: server.port, from: 'EVia Manager <noreply@evia.localhost>' });
    const writes: string[] = [];
    const record = (chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    };
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(record);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(record);
    try {
      await sender.send(
        createOutgoingEmail({
          to: address('anna@mailpit.localhost'),
          subject: 'Zaproszenie',
          text: 'link: https://panel.evia.test/activate#abc',
        }),
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      sender.close();
      await server.close();
    }
    expect(writes.join('')).not.toMatch(/activate#abc|anna@mailpit/);
    expect(server.messages).toHaveLength(1);
  });
});

async function smtpHarness(): Promise<EmailSenderHarness> {
  const server = await startSmtpTestServer();
  let port = server.port;
  const sender = new SmtpEmailSender({ host: '127.0.0.1', port: 0 + port, from: 'EVia Manager <noreply@evia.localhost>' });
  return {
    sender: {
      send: (email) => {
        // the harness may point the adapter at a closed port: a new adapter per call keeps the contract free of such knowledge
        const current =
          port === server.port ? sender : new SmtpEmailSender({ host: '127.0.0.1', port, from: 'EVia Manager <noreply@evia.localhost>' });
        return current.send(email);
      },
    },
    delivered: () =>
      server.messages.map((message) => ({
        to: message.recipients,
        subject: message.subject,
        text: message.text,
        headers: message.headers,
      })),
    makeUnavailable: async () => {
      port = await closedPort();
    },
    makeDeferring: () => {
      port = server.port;
      server.behaviour = 'defer_recipient';
    },
    makeRefusingRecipient: () => {
      port = server.port;
      server.behaviour = 'refuse_recipient';
    },
    stop: async () => {
      sender.close();
      await server.close();
    },
  };
}

/** A port nobody listens on: a server that was bound and closed. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

describeEmailSenderContract('SmtpEmailSender against a server on node:net', smtpHarness);
