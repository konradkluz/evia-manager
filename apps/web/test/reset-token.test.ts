import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureActivationToken, clearActivationToken, getActivationToken } from '../src/activation/activation-token.ts';
import { captureLinkToken } from '../src/activation/capture-link-token.ts';
import { captureResetToken, clearResetToken, getResetToken, getResetTokenSnapshot, subscribeResetToken } from '../src/reset/reset-token.ts';

const TOKEN = 'Rst_123-'.repeat(5) + 'xyz';

function history() {
  return { state: { key: 'k' }, replaceState: vi.fn() };
}

afterEach(() => {
  clearResetToken();
  clearActivationToken();
});

describe('token of a password reset link (EVM-025 AC2; SR-API-04, SR-LOG-02)', () => {
  it('EVM-025 AC2 on the reset page the token moves to memory and the address entry loses the fragment', () => {
    const target = history();
    captureResetToken({ pathname: '/reset-password', search: '', hash: `#${TOKEN}` }, target);
    expect(getResetToken()).toBe(TOKEN);
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(target.state, '', '/reset-password');
    clearResetToken();
    expect(getResetToken()).toBeNull();
  });

  it('EVM-025 AC2 a fragment that is not a token is dropped without being kept; a page without a fragment is left alone', () => {
    const target = history();
    captureResetToken({ pathname: '/reset-password', search: '?x=1', hash: '#nie-token' }, target);
    expect(getResetToken()).toBeNull();
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(target.state, '', '/reset-password?x=1');
    const untouched = history();
    captureResetToken({ pathname: '/reset-password', search: '', hash: '' }, untouched);
    expect(untouched.replaceState).not.toHaveBeenCalled();
  });

  it('EVM-025 AC2 a new link in the same tab changes the generation and notifies the page; clearing twice notifies once', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeResetToken(listener);
    const first = getResetTokenSnapshot().generation;
    captureResetToken({ pathname: '/reset-password', search: '', hash: `#${TOKEN}` }, history());
    expect(getResetTokenSnapshot().generation).toBe(first + 1);
    clearResetToken();
    clearResetToken();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    captureResetToken({ pathname: '/reset-password', search: '', hash: `#${TOKEN}` }, history());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('EVM-025 AC2 a reset token never reaches the activation page and an activation token never reaches the reset page', () => {
    captureLinkToken({ pathname: '/reset-password', search: '', hash: `#${TOKEN}` }, history());
    expect(getResetToken()).toBe(TOKEN);
    expect(getActivationToken()).toBeNull();
    clearResetToken();
    captureLinkToken({ pathname: '/activate', search: '', hash: `#${TOKEN}` }, history());
    expect(getActivationToken()).toBe(TOKEN);
    expect(getResetToken()).toBeNull();
    clearActivationToken();
    captureActivationToken({ pathname: '/reset-password', search: '', hash: '' }, history());
    expect(getResetToken()).toBeNull();
  });

  it('EVM-025 AC2 a token-shaped fragment on another page is removed and kept nowhere on the reset side', () => {
    const target = history();
    captureLinkToken({ pathname: '/login', search: '', hash: `#${TOKEN}` }, target);
    expect(target.replaceState).toHaveBeenCalledExactlyOnceWith(target.state, '', '/login');
    expect(getResetToken()).toBeNull();
  });
});
