import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

// The page keeps its states for a build WITHOUT the address of the company and with the clauses still a draft (EVM-063 AC2, AC3):
// the final content of EVM-133 has both filled in, so this file mocks the two values.
vi.mock('../src/privacy/content.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/privacy/content.ts')>()),
  CONTACT_EMAIL: null,
  DRAFT: true,
}));

describe('W-19 without the address and with a draft (EVM-063 AC2, AC3)', () => {
  it('EVM-063 AC3 without a configured address the page tells people to ask their supervisor and shows no empty link', async () => {
    await renderPanel('/privacy', createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') }));
    await screen.findByRole('heading', { level: 2, name: 'Pomoc' });
    expect(screen.getByText('Kontakt z administratorem: zapytaj przełożonego.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Zgłaszanie utraty sprzętu' }).textContent).toContain('zgłoś to od razu przełożonemu');
    expect(screen.queryByRole('link', { name: /mailto|@/ })).toBeNull();
  });

  it('EVM-063 AC2 while the clauses are a draft the page says so', async () => {
    await renderPanel('/privacy', createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') }));
    await screen.findByRole('heading', { level: 2, name: 'Prywatność' });
    expect(screen.getByText(/Projekt treści/)).toBeTruthy();
  });
});
