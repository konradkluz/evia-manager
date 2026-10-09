/**
 * A tiny stand-in for the browser of the panel in API tests: it keeps the session cookie and the CSRF token the way the
 * panel does, sends the headers a same-origin `fetch` carries (Origin, Sec-Fetch-Site) and nothing a browser would not
 * send. Tests that attack (cross-site, no Origin, no token) build their requests by hand with supertest instead.
 */
import request, { type Test } from 'supertest';
import { SESSION_COOKIE_NAME } from '../../src/modules/identity/domain/constants.ts';

/** What the synthetic browser calls itself (stored with the session, P9). */
export const USER_AGENT = 'Mozilla/5.0 (synthetic test browser)';

export class PanelClient {
  readonly #server: Parameters<typeof request>[0];
  readonly #origin: string;
  cookie: string | undefined;
  csrfToken: string | undefined;

  constructor(server: Parameters<typeof request>[0], origin: string) {
    this.#server = server;
    this.#origin = origin;
  }

  /** Mutation as the panel sends it: JSON, same-origin headers, session cookie, CSRF token when it has one. */
  post(path: string, body?: unknown): Test {
    let call = request(this.#server)
      .post(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookie !== undefined) call = call.set('Cookie', this.cookie);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  /** A PATCH as the panel sends it (same headers as a mutation); `headers` carries `If-Match` and `Idempotency-Key`. */
  patch(path: string, body?: unknown, headers: Readonly<Record<string, string>> = {}): Test {
    let call = request(this.#server)
      .patch(path)
      .set('User-Agent', USER_AGENT)
      .set('Origin', this.#origin)
      .set('Sec-Fetch-Site', 'same-origin');
    if (this.cookie !== undefined) call = call.set('Cookie', this.cookie);
    if (this.csrfToken !== undefined) call = call.set('X-CSRF-Token', this.csrfToken);
    for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
    return body === undefined ? call : call.set('Content-Type', 'application/json').send(JSON.stringify(body));
  }

  get(path: string): Test {
    const call = request(this.#server).get(path).set('User-Agent', USER_AGENT);
    return this.cookie === undefined ? call : call.set('Cookie', this.cookie);
  }

  /** Keeps the cookie of a response (`Set-Cookie`), as the browser would. */
  adopt(setCookie: string[] | string | undefined): void {
    const header = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (header === undefined) return;
    const pair = header.split(';')[0] ?? '';
    this.cookie = pair.endsWith('=') ? undefined : pair;
  }
}
