import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_SESSION, json } from './api-fake.ts';

describe('entry point (EVM-008 AC3)', () => {
  let panelRoot: { unmount: () => void } | undefined;
  afterEach(() => {
    // Unmount inside act so the React scheduler leaves no work behind after the environment is torn down.
    const toUnmount = panelRoot;
    panelRoot = undefined;
    if (toUnmount) {
      act(() => {
        toUnmount.unmount();
      });
    }
    document.getElementById('root')?.remove();
    vi.unstubAllGlobals();
  });

  it('EVM-008 AC3 the panel mounts in #root and shows the work orders page', async () => {
    // The entry point uses the browser fetch: the session answers as an active one.
    vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
      Promise.resolve(
        String(input instanceof Request ? input.url : input).includes('/work-orders')
          ? json(200, { items: [], nextCursor: null })
          : json(200, ACTIVE_SESSION),
      ),
    );
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const entry = await act(async () => import('../src/main.tsx'));
    panelRoot = entry.panelRoot;
    const { mount } = entry;
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie masz jeszcze zleceń.' })).toBeTruthy();
    expect(() => mount(null)).toThrow(/#root/);
  });
});
