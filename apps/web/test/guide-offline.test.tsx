import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

// The body of the guide cannot be loaded (offline): "Treść wymaga połączenia." with the title kept (EVM-066 AC6).
vi.mock('../src/guide/guide-sections.tsx', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

describe('"Instrukcja dla biura" offline (EVM-066 AC6)', () => {
  it('EVM-066 AC6 offline and not loaded: the title stays and the page says "Treść wymaga połączenia."', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await renderPanel('/guide', createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Treść wymaga połączenia.' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Instrukcja dla biura' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeTruthy();
  });
});
