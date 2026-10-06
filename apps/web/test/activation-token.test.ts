import { describe, expect, it, vi } from 'vitest';
import { captureActivationToken, clearActivationToken, getActivationToken, TOKEN_PATTERN } from '../src/activation/activation-token.ts';

const TOKEN = 'Abc_123-'.repeat(5) + 'xyz';

function history() {
  return { state: { key: 'k' }, replaceState: vi.fn() };
}

describe('token of a one-time link (EVM-016 AC5; SR-API-04, SR-LOG-02)', () => {
  it('EVM-016 AC5 the token has the shape of 43 base64url characters', () => {
    expect(TOKEN).toHaveLength(43);
    expect(TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(TOKEN_PATTERN.test(`${TOKEN}=`)).toBe(false);
    expect(TOKEN_PATTERN.test(TOKEN.slice(1))).toBe(false);
    expect(TOKEN_PATTERN.test(`${TOKEN.slice(1)}!`)).toBe(false);
  });

  it('EVM-016 AC5 on the activation page the token moves to memory and the address entry loses the fragment', () => {
    const target = history();
    captureActivationToken({ pathname: '/activate', search: '', hash: `#${TOKEN}` }, target);
    expect(getActivationToken()).toBe(TOKEN);
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(target.state, '', '/activate');
    clearActivationToken();
    expect(getActivationToken()).toBeNull();
  });

  it('EVM-016 AC5 the query part stays, a fragment that is not a token is dropped without being kept', () => {
    const target = history();
    captureActivationToken({ pathname: '/activate', search: '?x=1', hash: '#nie-token' }, target);
    expect(getActivationToken()).toBeNull();
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(target.state, '', '/activate?x=1');
  });

  it('EVM-016 AC5 a token-shaped fragment is removed on any page; other anchors and a missing fragment stay untouched', () => {
    const stripped = history();
    captureActivationToken({ pathname: '/work-orders', search: '', hash: `#${TOKEN}` }, stripped);
    expect(getActivationToken()).toBe(TOKEN);
    expect(stripped.replaceState).toHaveBeenCalledExactlyOnceWith(stripped.state, '', '/work-orders');
    clearActivationToken();

    const anchor = history();
    captureActivationToken({ pathname: '/account', search: '', hash: '#drugi-krok' }, anchor);
    captureActivationToken({ pathname: '/activate', search: '', hash: '' }, anchor);
    expect(anchor.replaceState).not.toHaveBeenCalled();
    expect(getActivationToken()).toBeNull();
  });

  it('EVM-016 AC5 the real address bar and history entry lose the fragment', () => {
    globalThis.history.replaceState(null, '', `/activate#${TOKEN}`);
    expect(globalThis.location.hash).toBe(`#${TOKEN}`);
    captureActivationToken(globalThis.location, globalThis.history);
    expect(globalThis.location.hash).toBe('');
    expect(globalThis.location.href).not.toContain(TOKEN);
    expect(getActivationToken()).toBe(TOKEN);
    globalThis.history.replaceState(null, '', '/');
  });
});
