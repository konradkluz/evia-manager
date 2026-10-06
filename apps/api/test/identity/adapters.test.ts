import { createHash } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import {
  PwnedPasswordsCheck,
  PWNED_MAX_RESPONSE_BYTES,
  PWNED_PASSWORDS_ORIGIN,
  type FetchLike,
} from '../../src/modules/identity/infrastructure/pwned-passwords.ts';

const sha1 = (password: string): string => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();

/** A fake of the range API that records every request. */
function rangeApi(respond: (prefix: string) => Response | Promise<Response>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchLike: FetchLike = (url, init) => {
    requests.push({ url, init });
    return Promise.resolve(respond(url.slice(url.lastIndexOf('/') + 1)));
  };
  return { requests, check: new PwnedPasswordsCheck(fetchLike) };
}

const text = (body: string, status = 200): Response => new Response(body, { status });

describe('Pwned Passwords — k-anonymity (EVM-016 AC3; SR-AUTH-02, SR-API-13, ASVS V6.2.4, V6.2.12)', () => {
  const password = 'Zq9-lamp-Orbit-4';
  const digest = sha1(password);

  it('EVM-016 AC3 only the 5-character SHA-1 prefix leaves the process, with Add-Padding, no cookies and no redirects', async () => {
    const { requests, check } = rangeApi(() => text('0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n'));
    expect(await check.check(password)).toBe('clean');
    expect(requests).toHaveLength(1);
    const [{ url, init } = { url: '', init: {} }] = requests;
    expect(url).toBe(`${PWNED_PASSWORDS_ORIGIN}/range/${digest.slice(0, 5)}`);
    expect(PWNED_PASSWORDS_ORIGIN).toBe('https://api.pwnedpasswords.com');
    expect(init).toMatchObject({
      method: 'GET',
      headers: { 'Add-Padding': 'true' },
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify([url, init.headers])).not.toContain(digest.slice(5));
    expect(JSON.stringify([url, init.headers])).not.toContain(password);
  });

  it('EVM-016 AC3 a suffix with a positive count is a hit; a suffix with the count 0 is padding, not a hit', async () => {
    const suffix = digest.slice(5);
    const hit = rangeApi(() => text(`ABCDEF0123456789ABCDEF0123456789ABC:3\r\n${suffix}:42\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:1`));
    expect(await hit.check.check(password)).toBe('breached');
    const padding = rangeApi(() => text(`${suffix}:0\r\nABCDEF0123456789ABCDEF0123456789ABC:3`));
    expect(await padding.check.check(password)).toBe('clean');
    const lowercase = rangeApi(() => text(`${suffix.toLowerCase()}:5`));
    expect(await lowercase.check.check(password)).toBe('clean');
  });

  it('EVM-016 AC3 the exact suffix is required: a longer or shorter line is no match', async () => {
    const suffix = digest.slice(5);
    expect(await rangeApi(() => text(`${suffix}A:5`)).check.check(password)).toBe('clean');
    expect(await rangeApi(() => text(`${suffix.slice(1)}:5`)).check.check(password)).toBe('clean');
    expect(await rangeApi(() => text('')).check.check(password)).toBe('clean');
  });

  it.each([
    ['HTTP 500', () => text('boom', 500)],
    ['HTTP 429', () => text('slow down', 429)],
    ['a redirect (refused by redirect: error)', () => Promise.reject(new TypeError('fetch failed'))],
    ['a timeout', () => Promise.reject(new DOMException('The operation timed out', 'TimeoutError'))],
    ['a network error', () => Promise.reject(new Error('ECONNRESET'))],
    ['an empty body object', () => ({ ok: true, body: null }) as unknown as Response],
  ])('EVM-016 AC3 %s makes the check unavailable (the caller falls back to the local checks)', async (_label, respond) => {
    expect(await rangeApi(respond).check.check(password)).toBe('unavailable');
  });

  it('EVM-016 AC3 a response over the size limit is not read to the end and counts as unavailable', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    expect(PWNED_MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
    expect(await rangeApi(() => new Response(stream, { status: 200 })).check.check(password)).toBe('unavailable');
  });

  it('EVM-016 AC3 the default fetch is the global one and an unreachable service is unavailable, not an error', async () => {
    const check = new PwnedPasswordsCheck(() => Promise.reject(new Error('no egress in tests')));
    expect(await check.check(password)).toBe('unavailable');
    expect(new PwnedPasswordsCheck()).toBeInstanceOf(PwnedPasswordsCheck);
  });
});

describe('Argon2id password hashing (EVM-016 AC3; SR-AUTH-04, ADR-0005)', () => {
  it('EVM-016 AC3 the hash is Argon2id v19 with 19 MiB, 2 passes and one lane in a PHC string with a random salt', async () => {
    const hasher = new Argon2PasswordHasher();
    const first = await hasher.hash('Zq9-lamp-Orbit-4');
    const second = await hasher.hash('Zq9-lamp-Orbit-4');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Zq9-lamp-Orbit-4');
    expect(await verify(first, 'Zq9-lamp-Orbit-4')).toBe(true);
    expect(await verify(first, 'Zq9-lamp-Orbit-5')).toBe(false);
  });

  it('EVM-016 AC3 the password is hashed as given: the caller normalises to NFC, so NFC and NFD forms hash differently here', async () => {
    const hasher = new Argon2PasswordHasher();
    const nfc = 'zażółć gęślą jaźń';
    const hash = await hasher.hash(nfc);
    expect(await verify(hash, nfc)).toBe(true);
    expect(await verify(hash, nfc.normalize('NFD'))).toBe(false);
  });
});
