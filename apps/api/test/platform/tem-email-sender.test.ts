import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOutgoingEmail, parseEmailAddress, type EmailAddress } from '../../src/platform/email/email-address.ts';
import { EmailPermanentError, EmailTransientError } from '../../src/platform/email/email-errors.ts';
import { GuardedEmailSender } from '../../src/platform/email/guarded-email-sender.ts';
import * as temModule from '../../src/platform/email/tem-email-sender.ts';
import {
  TEM_ENDPOINT,
  TEM_SENDER_NAME,
  createTemEmailSender,
  createTemEmailSenderForTest,
  mapTemFailure,
  mapTemStatus,
  type TemFetch,
  type TemSenderOptions,
} from '../../src/platform/email/tem-email-sender.ts';
import { describeEmailSenderContract, type EmailSenderHarness } from '../support/email-sender-contract.ts';

const KEY = '00000000-0000-4000-8000-000000000001';
const PROJECT = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FROM = 'powiadomienia@panel.eviacharge.pl';
const RECIPIENT = 'anna.testowa@biuro-firma.pl';
const address = (value: string): EmailAddress => parseEmailAddress(value) as EmailAddress;

const options = (overrides: Partial<TemSenderOptions> = {}): TemSenderOptions => ({
  from: FROM,
  apiKey: KEY,
  projectId: PROJECT,
  policy: { mode: 'otwarty', allowed: new Set() },
  ...overrides,
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function recorder(respond: (call: Call) => Promise<Response> | Response): { fetch: TemFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const ok = () => new Response('{"emails":[{"id":"x","message_id":"anna.testowa@biuro-firma.pl"}]}', { status: 200 });
const message = (to = RECIPIENT) =>
  createOutgoingEmail({ to: address(to), subject: 'Zaproszenie — zażółć', text: 'Dzień dobry\nhttps://panel.eviacharge.pl/a#tok' });
const outcome = (promise: Promise<void>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );
const observable = (error: unknown): string => JSON.stringify(error, Object.getOwnPropertyNames(error)) + ((error as Error).stack ?? '');

describe('the adapter of Scaleway TEM (EVM-089 AC1, AC4; SR-API-13, SR-COMM-02)', () => {
  it('EVM-089 AC1 AC4 the request goes to the constant URL only, with the key in the header, one recipient without a name and the fixed sender', async () => {
    const { fetch, calls } = recorder(ok);
    await createTemEmailSenderForTest(options(), fetch).send(message());
    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.url).toBe('https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails');
    expect(call.url).toBe(TEM_ENDPOINT);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    expect(call.init.credentials).toBe('omit');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    expect(call.init.headers).toMatchObject({ 'X-Auth-Token': KEY, 'Content-Type': 'application/json' });
    expect(JSON.parse(call.init.body as string)).toEqual({
      project_id: PROJECT,
      from: { email: FROM, name: TEM_SENDER_NAME },
      to: [{ email: RECIPIENT }],
      subject: 'Zaproszenie — zażółć',
      text: 'Dzień dobry\nhttps://panel.eviacharge.pl/a#tok',
    });
  });

  it('EVM-089 AC4 the status of an answer is mapped to a class with a fixed code: 400 and 422 permanent, a wrong key, 429, 5xx and the rest transient', () => {
    expect(mapTemStatus(400)).toBeInstanceOf(EmailPermanentError);
    expect(mapTemStatus(422)).toBeInstanceOf(EmailPermanentError);
    for (const status of [401, 403]) expect(mapTemStatus(status)).toMatchObject({ name: 'EmailTransientError', code: 'provider_auth' });
    for (const status of [429, 500, 502, 503])
      expect(mapTemStatus(status)).toMatchObject({ name: 'EmailTransientError', code: 'temporary_refusal' });
    for (const status of [404, 409, 301]) expect(mapTemStatus(status)).toMatchObject({ name: 'EmailTransientError', code: 'send_failed' });
  });

  it('EVM-089 AC4 a timeout is transient `timeout`; a network error and a refused redirect are transient `connection_failed` without the text of the cause', async () => {
    expect(mapTemFailure(new DOMException('x', 'TimeoutError'))).toMatchObject({ code: 'timeout' });
    expect(mapTemFailure(new DOMException('x', 'AbortError'))).toMatchObject({ code: 'timeout' });
    expect(mapTemFailure('text')).toMatchObject({ code: 'connection_failed' });
    // fetch with `redirect: 'error'` rejects a 3xx with a TypeError: it is a failure, never a followed redirect
    const redirected = recorder(() =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('unexpected redirect to https://evil.test/anna.testowa') })),
    );
    const failure = await outcome(createTemEmailSenderForTest(options(), redirected.fetch).send(message()));
    expect(failure).toBeInstanceOf(EmailTransientError);
    expect((failure as EmailTransientError).code).toBe('connection_failed');
    expect((failure as Error).cause).toBeUndefined();
    expect(observable(failure)).not.toMatch(/evil|anna|redirect/);
  });

  it('EVM-089 AC4 the request has a timeout of 5 s and a fetch that times out gives a transient `timeout`', async () => {
    const timedOut = recorder(() => Promise.reject(new DOMException('The operation timed out', 'TimeoutError')));
    const failure = await outcome(createTemEmailSenderForTest(options(), timedOut.fetch).send(message()));
    expect(failure).toMatchObject({ name: 'EmailTransientError', code: 'timeout' });
    expect(temModule.TEM_TIMEOUT_MS).toBe(5000);
  });

  it('EVM-089 AC4 B the key and the text of the answer are in no error: a wrong key (401) leaves only the fixed code', async () => {
    const refused = recorder(() => new Response(`{"message":"invalid token ${KEY} for anna.testowa@biuro-firma.pl"}`, { status: 401 }));
    const failure = await outcome(createTemEmailSenderForTest(options(), refused.fetch).send(message()));
    expect(failure).toMatchObject({ name: 'EmailTransientError', code: 'provider_auth', message: 'provider_auth' });
    expect(observable(failure)).not.toContain(KEY);
    expect(observable(failure)).not.toMatch(/anna|invalid token/);
    expect((failure as Error).cause).toBeUndefined();
  });

  it('EVM-089 AC4 an oversize or broken body of the answer does not change the outcome of an accepted message and is never kept', async () => {
    const big = recorder(() => new Response('x'.repeat(200_000), { status: 200 }));
    await expect(createTemEmailSenderForTest(options(), big.fetch).send(message())).resolves.toBeUndefined();
    const broken = recorder(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error('broken'));
            },
          }),
          { status: 200 },
        ),
    );
    await expect(createTemEmailSenderForTest(options(), broken.fetch).send(message())).resolves.toBeUndefined();
    const empty = recorder(() => new Response(null, { status: 200 }));
    await expect(createTemEmailSenderForTest(options(), empty.fetch).send(message())).resolves.toBeUndefined();
  });

  it('EVM-089 AC2 B fail closed at construction: a malformed key, project or sender is refused without the value', () => {
    const noFetch = recorder(ok).fetch;
    for (const bad of [
      { apiKey: 'not-a-uuid' },
      { apiKey: '' },
      { projectId: 'xyz' },
      { from: 'Evia <powiadomienia@panel.eviacharge.pl>' },
      { from: '' },
    ]) {
      let thrown: unknown;
      try {
        createTemEmailSenderForTest(options(bad), noFetch);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(bad)).toBeInstanceOf(EmailPermanentError);
      expect(observable(thrown)).not.toMatch(/not-a-uuid|xyz|Evia </);
    }
  });

  it('EVM-089 AC2 the adapter exists only behind the guard: the factories return a GuardedEmailSender, the class is not exported', () => {
    expect(createTemEmailSender(options())).toBeInstanceOf(GuardedEmailSender);
    expect(createTemEmailSenderForTest(options(), recorder(ok).fetch)).toBeInstanceOf(GuardedEmailSender);
    expect(
      Object.keys(temModule)
        .filter((name) => /Sender$/.test(name) && !name.startsWith('create'))
        .sort(),
    ).toEqual([]);
    expect(Object.keys(temModule).some((name) => name === 'TemEmailSender')).toBe(false);
  });

  it('EVM-089 AC2 the guard stands before the provider: a reserved domain and an address off the list make NO request, and the job gets a success', async () => {
    const { fetch, calls } = recorder(ok);
    const listed = createTemEmailSenderForTest(options({ policy: { mode: 'lista', allowed: new Set([RECIPIENT]) } }), fetch);
    await listed.send(message('jan@biuro-firma.pl'));
    await listed.send(message('anna@firma.test'));
    expect(calls).toEqual([]);
    await listed.send(message());
    expect(calls).toHaveLength(1);
    const open = createTemEmailSenderForTest(options(), fetch);
    await open.send(message('anna@example.com'));
    await open.send(message('anna@zadanie.test'));
    expect(calls).toHaveLength(1);
  });

  it('EVM-089 AC4 the host is a constant: the production sources have no setting for the URL, and the test factory is used by no source', () => {
    const root = join(import.meta.dirname, '..', '..', 'src');
    const sources = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
      });
    const files = sources(root).map((path) => ({ name: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
    expect(files.filter((file) => file.text.includes('createTemEmailSenderForTest')).map((file) => file.name)).toEqual([
      'platform/email/tem-email-sender.ts',
    ]);
    expect(files.filter((file) => /api\.scaleway\.com/.test(file.text)).map((file) => file.name)).toEqual([
      'platform/email/tem-email-sender.ts',
    ]);
    expect(
      files.filter((file) => /TEM_(ENDPOINT|URL|HOST)/.test(file.text) && /process\.env|env\[/.test(file.text)).map((file) => file.name),
    ).toEqual([]);
    // the only users of the factory are the composition root of the worker
    expect(
      files
        .filter((file) => file.text.includes('createTemEmailSender('))
        .map((file) => file.name)
        .sort(),
    ).toEqual(['platform/email/tem-email-sender.ts', 'worker/worker-process.ts']);
  });
});

function temHarness(): Promise<EmailSenderHarness> {
  const delivered: { to: string[]; subject: string; text: string; headers: Map<string, string> }[] = [];
  let behaviour: 'ok' | 'down' | 'defer' | 'refuse' = 'ok';
  const fake: TemFetch = (_url, init) => {
    if (behaviour === 'down') return Promise.reject(new TypeError('fetch failed'));
    if (behaviour === 'defer') return Promise.resolve(new Response('try later', { status: 503 }));
    if (behaviour === 'refuse') return Promise.resolve(new Response('bad recipient', { status: 422 }));
    const body = JSON.parse(init.body as string) as { to: { email: string }[]; subject: string; text: string };
    delivered.push({
      to: body.to.map((entry) => entry.email),
      subject: body.subject,
      text: body.text,
      // the provider builds the MIME message: text/plain UTF-8, no cc, bcc, reply-to, x-mailer (the body has none of them)
      headers: new Map([
        ['content-type', 'text/plain; charset=utf-8'],
        ['content-transfer-encoding', 'base64'],
      ]),
    });
    return Promise.resolve(ok());
  };
  return Promise.resolve({
    sender: createTemEmailSenderForTest(options(), fake),
    recipient: RECIPIENT,
    delivered: () => delivered,
    makeUnavailable: () => {
      behaviour = 'down';
      return Promise.resolve();
    },
    makeDeferring: () => {
      behaviour = 'defer';
    },
    makeRefusingRecipient: () => {
      behaviour = 'refuse';
    },
    stop: () => Promise.resolve(),
  });
}

describeEmailSenderContract('TemEmailSender behind the guard, against a fake of fetch', temHarness);
