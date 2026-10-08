// Component test setup (EVM-008 AC3): DOM cleanup after each test and the modal <dialog> API, which jsdom lacks.
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { clearActivationToken } from '../src/activation/activation-token.ts';
import { setCsrfToken } from '../src/session/csrf.ts';

// findBy*/waitFor wait up to 1 s by default; on the shared CI runner (many workers at once) debounced searches need longer. A passing test is not slowed down.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  // Memory of the tab (token of a link, CSRF token) never leaks between tests.
  clearActivationToken();
  setCsrfToken(null);
});

if (typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
