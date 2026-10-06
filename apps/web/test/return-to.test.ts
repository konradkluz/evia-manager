import { describe, expect, it } from 'vitest';
import { DEFAULT_RETURN_TO, resolveReturnTo } from '../src/session/return-to.ts';

const ORIGIN = 'https://panel.example.test';

describe('returnTo after logging in (EVM-067 AC1; SR-WEB-06, CWE-601)', () => {
  it('EVM-067 AC1 a relative path of the panel is kept, with its query', () => {
    expect(resolveReturnTo('/work-orders', ORIGIN)).toBe('/work-orders');
    expect(resolveReturnTo('/work-orders/123?tab=media', ORIGIN)).toBe('/work-orders/123?tab=media');
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash', '/\\evil.example'],
    ['tab inside', '/\t/evil.example'],
    ['encoded slashes', '/%2F%2Fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['absolute address', 'https://evil.example/work-orders'],
    ['own address', `${ORIGIN}/work-orders`],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,x'],
    ['no leading slash', 'work-orders'],
    ['space', '/work orders'],
    ['new line', '/work-orders\n/evil'],
    ['broken encoding', '/%E0%A4%A'],
    ['api path', '/api/v1/auth/session'],
    ['auth path (loop)', '/auth/login'],
    ['encoded auth path', '/%61uth/login'],
    ['login page (loop)', '/login'],
    ['second step page (loop)', '/login/second-step'],
    ['activation page', '/activate'],
    ['empty', ''],
    ['not a text', 42],
    ['nothing', undefined],
  ])('EVM-067 AC1 %s goes to W-10', (_name, value) => {
    expect(resolveReturnTo(value, ORIGIN)).toBe(DEFAULT_RETURN_TO);
  });

  it('EVM-067 AC1 W-10 is the list of work orders, and a path that only starts like a refused prefix is fine', () => {
    expect(DEFAULT_RETURN_TO).toBe('/work-orders');
    expect(resolveReturnTo('/authors', ORIGIN)).toBe('/authors');
  });
});
