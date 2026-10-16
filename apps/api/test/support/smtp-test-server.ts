/**
 * A minimal SMTP server for the tests of the SMTP adapter (EVM-024 D7): `node:net`, no dependency, bound to the loopback.
 * It accepts the session of the library (EHLO, MAIL, RCPT, DATA, QUIT), keeps what it received and can be told to behave badly:
 * refuse the recipient (550), defer (451), refuse the message (554) or never answer (a hang). Only synthetic data goes through it.
 */
import { createServer, type Server, type Socket } from 'node:net';

export type SmtpBehaviour = 'accept' | 'refuse_recipient' | 'defer_recipient' | 'refuse_message' | 'hang_after_greeting';

export interface ReceivedMessage {
  readonly mailFrom: string;
  readonly recipients: readonly string[];
  /** The headers as received (unfolded), lower-cased names. */
  readonly headers: ReadonlyMap<string, string>;
  /** The raw data of the message (headers and body, dot-unstuffed). */
  readonly raw: string;
  /** The text of the body, decoded from its transfer encoding. */
  readonly text: string;
  /** The subject with RFC 2047 encoded words decoded. */
  readonly subject: string;
}

export interface SmtpTestServer {
  readonly port: number;
  readonly messages: ReceivedMessage[];
  behaviour: SmtpBehaviour;
  close(): Promise<void>;
}

function unfold(headerBlock: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of headerBlock.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function decodeQuotedPrintable(body: string): Buffer {
  const joined = body.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < joined.length; index += 1) {
    if (joined[index] === '=' && /^[0-9A-F]{2}$/i.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(joined.charCodeAt(index));
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(headers: ReadonlyMap<string, string>, body: string): string {
  const encoding = (headers.get('content-transfer-encoding') ?? '7bit').toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body).toString('utf8');
  return body;
}

function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_match, kind: string, payload: string) =>
      kind.toLowerCase() === 'b'
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeQuotedPrintable(payload.replace(/_/g, ' ')).toString('utf8'),
    );
}

function parseMessage(mailFrom: string, recipients: string[], data: string): ReceivedMessage {
  const split = data.indexOf('\r\n\r\n');
  const headerBlock = split === -1 ? data : data.slice(0, split);
  const body = split === -1 ? '' : data.slice(split + 4);
  const headers = unfold(headerBlock);
  return {
    mailFrom,
    recipients,
    headers,
    raw: data,
    text: decodeBody(headers, body),
    subject: decodeEncodedWords(headers.get('subject') ?? ''),
  };
}

export async function startSmtpTestServer(): Promise<SmtpTestServer> {
  const messages: ReceivedMessage[] = [];
  const sockets = new Set<Socket>();
  const state = { behaviour: 'accept' as SmtpBehaviour };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = '';
    let mailFrom = '';
    let recipients: string[] = [];
    let data: string | undefined;
    const reply = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    if (state.behaviour === 'hang_after_greeting') return;
    reply('220 test ESMTP');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          const body = `${data}${buffer.slice(0, end)}`.replace(/^\.\./gm, '.');
          buffer = buffer.slice(end + 5);
          data = undefined;
          if (state.behaviour === 'refuse_message') {
            reply('554 message refused');
          } else {
            messages.push(parseMessage(mailFrom, recipients, Buffer.from(body, 'latin1').toString('utf8')));
            reply('250 queued');
          }
          continue;
        }
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO') reply('250 test');
        else if (command === 'HELO') reply('250 test');
        else if (command === 'MAIL') {
          mailFrom = line.slice(10).replace(/[<>]/g, '').split(' ')[0] ?? '';
          recipients = [];
          reply('250 ok');
        } else if (command === 'RCPT') {
          if (state.behaviour === 'refuse_recipient') reply('550 no such recipient');
          else if (state.behaviour === 'defer_recipient') reply('451 try later');
          else {
            recipients.push(line.slice(8).replace(/[<>]/g, '').split(' ')[0] ?? '');
            reply('250 ok');
          }
        } else if (command === 'DATA') {
          data = '';
          reply('354 go ahead');
        } else if (command === 'RSET' || command === 'NOOP') reply('250 ok');
        else if (command === 'QUIT') {
          reply('221 bye');
          socket.end();
          return;
        } else reply('502 not implemented');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    port,
    messages,
    get behaviour() {
      return state.behaviour;
    },
    set behaviour(value: SmtpBehaviour) {
      state.behaviour = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}
