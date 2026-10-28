import { describe, expect, it } from 'vitest';
import { REDACTED, redactText, scrubBreadcrumb, scrubEvent, scrubUrl } from '../src/index.ts';

// Synthetic token: 43 characters of the URL-safe alphabet, like the real format (32 bytes, base64url). Not a secret.
const TOKEN = 'SyntheticTokenAAAAAAAAAAAAAAAAAAAAAAAAAAA_-';
const USER_ID = '0b9f6a1e-5c7d-4e0a-9d1b-2f3a4b5c6d7e';
type Out = Record<string, unknown>;

function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) current = (current as Record<string | number, unknown>)[key];
  return current;
}

function hostileEvent(): Record<string, unknown> {
  return {
    event_id: 'a'.repeat(32),
    level: 'error',
    environment: 'staging',
    server_name: 'vm-staging-1',
    message: `Cannot POST /api/v1/auth/activation/${TOKEN}`,
    transaction: `POST /api/v1/auth/activation/${TOKEN}?t=${TOKEN}`,
    request: {
      method: 'post',
      url: `https://staging.example.test/api/v1/auth/activation/${TOKEN}?token=${TOKEN}#${TOKEN}`,
      query_string: `token=${TOKEN}`,
      cookies: { session: TOKEN },
      headers: { Referer: `https://x.test/#${TOKEN}`, 'X-CSRF-Token': TOKEN, Authorization: `Bearer ${TOKEN}` },
      data: { token: TOKEN, password: 'not-a-real-password' },
    },
    exception: {
      values: [
        {
          type: 'Error',
          value: `failed for ${TOKEN} and user a.b@example.test`,
          stacktrace: {
            frames: [
              {
                filename: `https://x.test/app.js?v=${TOKEN}`,
                function: 'activate',
                lineno: 3,
                vars: { token: TOKEN },
                context_line: `const t = '${TOKEN}'`,
              },
            ],
          },
        },
      ],
    },
    tags: { service: 'api', secret: TOKEN, alertCode: 'account_locked' },
    extra: { token: TOKEN },
    contexts: { culture: { locale: 'pl' } },
    user: { id: USER_ID, email: 'a.b@example.test', ip_address: '203.0.113.7' },
    breadcrumbs: [
      { category: 'fetch', data: { url: `/api/v1/auth/activation/check?token=${TOKEN}`, method: 'POST', status_code: 400 } },
      { category: 'navigation', data: { from: `/#${TOKEN}`, to: `/aktywacja#${TOKEN}` } },
      { category: 'console', message: `token ${TOKEN}`, data: { arguments: [TOKEN] } },
    ],
  };
}

describe('EVM-085 AC7 scrubEvent', () => {
  it('EVM-085 AC7 positive control: the hostile event does contain the token before scrubbing', () => {
    expect(JSON.stringify(hostileEvent())).toContain(TOKEN);
  });

  it('EVM-085 AC7 removes the token from every place of the event', () => {
    const out = JSON.stringify(scrubEvent(hostileEvent()));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('not-a-real-password');
    expect(out).not.toContain('a.b@example.test');
    expect(out).not.toContain('203.0.113.7');
    expect(out).not.toContain('vm-staging-1');
  });

  it('EVM-085 AC6 keeps only the allow-listed parts', () => {
    const out = scrubEvent(hostileEvent()) as Out;
    expect(out['request']).toEqual({
      method: 'POST',
      url: `https://staging.example.test/api/v1/auth/activation/${REDACTED}`,
    });
    expect(out['user']).toEqual({ id: USER_ID });
    expect(out['tags']).toEqual({ service: 'api', alertCode: 'account_locked' });
    expect(out['transaction']).toBe(`POST /api/v1/auth/activation/${REDACTED}`);
    expect(out['extra']).toBeUndefined();
    expect(out['contexts']).toBeUndefined();
    expect(out['server_name']).toBeUndefined();
    expect(at(out, 'exception', 'values', 0, 'stacktrace', 'frames', 0)).toEqual({
      filename: 'https://x.test/app.js',
      function: 'activate',
      lineno: 3,
    });
  });

  it('EVM-085 AC6 drops a user without a UUID id and honours custom tags', () => {
    const out = scrubEvent(
      { user: { id: 'not-a-uuid' }, tags: { a: 'x', b: 'y', n: 1, f: true, o: {} } },
      { allowedTags: ['a', 'n', 'f', 'o'] },
    ) as Out;
    expect(out['user']).toBeUndefined();
    expect(out['tags']).toEqual({ a: 'x', n: 1, f: true });
  });

  it('EVM-085 AC6 tolerates malformed input', () => {
    const out = scrubEvent({
      request: 'x',
      exception: { values: [null, { mechanism: { type: 'onerror', handled: false, junk: {} }, stacktrace: { frames: [null] } }] },
      tags: 'x',
      breadcrumbs: [null, 5],
      sdk: { name: 'sentry.javascript.node', version: '1.0.0', integrations: ['x'] },
    }) as Out;
    expect(out['request']).toBeUndefined();
    expect(at(out, 'exception', 'values', 0)).toEqual({ mechanism: { type: 'onerror', handled: false }, stacktrace: { frames: [{}] } });
    expect(out['breadcrumbs']).toEqual([]);
    expect(out['sdk']).toEqual({ name: 'sentry.javascript.node', version: '1.0.0' });
    expect(scrubEvent({ exception: {} })).toEqual({});
  });
});

describe('EVM-085 AC7 scrubBreadcrumb', () => {
  it('EVM-085 AC7 reduces http, fetch, xhr and navigation breadcrumbs to the path', () => {
    for (const category of ['http', 'fetch', 'xhr', 'navigation']) {
      const out = JSON.stringify(
        scrubBreadcrumb({ category, data: { url: `/x?q=${TOKEN}#${TOKEN}`, from: `/a#${TOKEN}`, to: `/b?${TOKEN}`, request_body: TOKEN } }),
      );
      expect(out).not.toContain(TOKEN);
      expect(out).toContain('/x');
    }
  });

  it('EVM-085 AC7 drops the data of other categories and redacts messages', () => {
    const out = scrubBreadcrumb({ category: 'console', level: 'log', message: `Bearer ${TOKEN}`, data: { arguments: [TOKEN] } });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out).toEqual({ category: 'console', level: 'log', message: `Bearer ${REDACTED}` });
  });
});

describe('EVM-085 AC7 redactText and scrubUrl', () => {
  const synthetic = [
    ['activation path', `GET /api/v1/auth/activation/${TOKEN}/x`, TOKEN],
    ['43-character token', `value=${TOKEN}`, TOKEN],
    ['JWT', 'eyJhbGciOiJI.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2QT4fwpM', 'SflKxwRJSMeKKF2QT4fwpM'],
    ['Bearer', 'Authorization: Bearer abc.def-ghi_jkl', 'abc.def-ghi_jkl'],
    ['GitHub token', 'ghp_' + 'A'.repeat(36), 'AAAAAAAAAA'],
    ['GitHub fine-grained token', 'github_pat_' + 'B'.repeat(40), 'BBBBBBBBBB'],
    ['S3 signature', 'https://s3.example.test/k?X-Amz-Signature=deadbeef', 'deadbeef'],
    ['S3 credential', 'k&X-Amz-Credential=cred1&x=2', 'cred1'],
    ['S3 session token', 'k&X-Amz-Security-Token=sesstok', 'sesstok'],
    ['e-mail', 'mail a.b@example.test', 'a.b@example.test'],
    ['query after path', '/x/y?token=abc', 'abc'],
    ['fragment after path', '/aktywacja#abcdefgh', 'abcdefgh'],
  ] as const;

  for (const [name, text, secret] of synthetic) {
    it(`EVM-085 AC7 redacts: ${name}`, () => {
      expect(text).toContain(secret);
      expect(redactText(text)).not.toContain(secret);
    });
  }

  it('EVM-085 AC7 positive control: harmless text is unchanged', () => {
    expect(redactText('Cannot GET /api/v1/work-orders')).toBe('Cannot GET /api/v1/work-orders');
    expect(redactText('why?')).toBe('why?');
  });

  it('EVM-085 AC6 scrubUrl strips query and fragment and never throws', () => {
    expect(scrubUrl('https://a.test/p/q?x=1#y')).toBe('https://a.test/p/q');
    expect(scrubUrl('/p#y')).toBe('/p');
    expect(scrubUrl('/p')).toBe('/p');
    expect(scrubUrl('')).toBe('');
    expect(scrubUrl(`/api/v1/auth/activation/${TOKEN}`)).toBe(`/api/v1/auth/activation/${REDACTED}`);
  });

  it('EVM-085 AC7 stays linear on hostile input', () => {
    const started = Date.now();
    redactText('a?'.repeat(50_000) + '#'.repeat(50_000) + 'Bearer ' + 'A'.repeat(100_000));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
