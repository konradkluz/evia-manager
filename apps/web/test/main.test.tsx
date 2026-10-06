import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_SESSION, json } from './api-fake.ts';

describe('entry point (EVM-008 AC3)', () => {
  it('EVM-008 AC3 the panel mounts in #root and shows the work orders page', async () => {
    // The entry point uses the browser fetch: the session answers as an active one.
    vi.stubGlobal('fetch', () => Promise.resolve(json(200, ACTIVE_SESSION)));
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const { mount } = await act(async () => import('../src/main.tsx'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeTruthy();
    expect(() => mount(null)).toThrow(/#root/);
    root.remove();
    vi.unstubAllGlobals();
  });
});
