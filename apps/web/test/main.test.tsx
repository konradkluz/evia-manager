import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('entry point (EVM-008 AC3)', () => {
  it('EVM-008 AC3 the panel mounts in #root and shows the work orders page', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    const { mount } = await act(async () => import('../src/main.tsx'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeTruthy();
    expect(() => mount(null)).toThrow(/#root/);
    root.remove();
  });
});
