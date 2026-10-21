/**
 * A tiny stand-in for the browser of the panel in API tests: it keeps the session cookie and the CSRF token the way the
 * panel does, sends the headers a same-origin `fetch` carries (Origin, Sec-Fetch-Site) and nothing a browser would not
 * send. Tests that attack (cross-site, no Origin, no token) build their requests by hand with supertest instead.
 */
import request, { type Test } from 'supertest';
import { DEVICE_COOKIE_NAME, SESSION_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';

/** What the synthetic browser calls itself (stored with the session, P9). */
export const USER_AGENT = 'Mozilla/5.0 (synthetic test browser)';

export class PanelClient {
  readonly #server: Parameters<typeof request>[0];
  readonly #origin: string;
  cookie: string | undefined;
  /** The cookie of a known browser (`__Host-evia_device`, EVM-026): kept like the session cookie, sent with every request. */
  deviceCookie: string | undefined;
  csrfToken: string | undefined;

  constructor(server: Parameters<typeof request>[0], origin: string) {
    this.#server = server;
    this.#origin = origin;
  }

  /** Mutation as the panel sends it: JSON, same-origin headers, session cookie, CSRF token when it has one; `headers` carries `If-Match` and `Idempotency-Key`. */
  post(path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server)
      .post(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookieHeader() !== undefined) call = call.set('Cookie', this.cookieHeader() as string);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  /** A PUT as the panel sends it (same headers as a mutation); `headers` carries `If-Match`. */
  put(path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server)
      .put(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookieHeader() !== undefined) call = call.set('Cookie', this.cookieHeader() as string);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  /** A PATCH as the panel sends it (same headers as a mutation); `headers` carries `If-Match` and `Idempotency-Key`. */
  patch(path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server)
      .patch(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookieHeader() !== undefined) call = call.set('Cookie', this.cookieHeader() as string);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  /** A DELETE as the panel sends it (same headers as a mutation, no body); `headers` carries `If-Match` and `Idempotency-Key`. */
  delete(path: string, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server)
      .delete(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookieHeader() !== undefined) call = call.set('Cookie', this.cookieHeader() as string);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return call;
  }

  get(path: string): Test {
    const call = request(this.#server).get(path).set('User-Agent', USER_AGENT);
    return this.cookieHeader() === undefined ? call : call.set('Cookie', this.cookieHeader() as string);
  }

  /** The `Cookie` header the browser would send: the session cookie and the cookie of the known browser. */
  cookieHeader(): string | undefined {
    const pairs = [this.cookie, this.deviceCookie].filter((pair) => pair !== undefined);
    return pairs.length === 0 ? undefined : pairs.join('; ');
  }

  /** Keeps the cookies of a response (`Set-Cookie`), as the browser would. */
  adopt(setCookie: string[] | string | undefined): void {
    const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    const pairOf = (name: string): string | undefined => {
      const header = headers.find((value) => value.startsWith(`${name}=`));
      const pair = header?.split(';')[0];
      return pair === undefined ? undefined : pair.endsWith('=') ? '' : pair;
    };
    const session = pairOf(SESSION_COOKIE_NAME);
    if (session !== undefined) this.cookie = session === '' ? undefined : session;
    const device = pairOf(DEVICE_COOKIE_NAME);
    if (device !== undefined) this.deviceCookie = device === '' ? undefined : device;
  }
}
