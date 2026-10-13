import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

// A configured functional address (a synthetic one): the only link on the page that is not the way back (EVM-063 AC3).
vi.mock('../src/privacy/content.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/privacy/content.ts')>()),
  CONTACT_EMAIL: 'pomoc@firma.test',
}));

describe('contact of the administrator (EVM-063 AC3; SR-WEB-03)', () => {
  it('EVM-063 AC3 the address is a mailto link whose text is the address and whose name starts with it, in both places', async () => {
    await renderPanel('/privacy', createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') }));
    const help = await screen.findByRole('heading', { level: 2, name: 'Pomoc' });
    const card = help.closest('section');
    if (card === null) throw new Error('no card');
    const links = within(card).getAllByRole('link', { name: /^pomoc@firma\.test — napisz do administratora$/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('mailto:pomoc%40firma.test');
      expect(link.textContent.startsWith('pomoc@firma.test')).toBe(true);
    }
    expect(within(card).getByText(/^Kontakt z administratorem:/)).toBeTruthy();
    expect(within(card).getByRole('region', { name: 'Zgłaszanie utraty sprzętu' }).textContent).toContain(
      'zgłoś to od razu administratorowi:',
    );
    expect(within(card).queryByText(/zapytaj przełożonego/)).toBeNull();
  });
});
