import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../src/app.tsx';
import { createI18n } from '../src/i18n/i18n.ts';
import { LoadedSections } from '../src/pages/privacy-page.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, ENROLLMENT_SESSION, json, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';

// W-19 "Prywatność i pomoc" (EVM-063): static content in the panel and before logging in (flow 15).

const SESSION_REQUEST = 'GET /api/v1/auth/session';
const requestsOf = (api: ReturnType<typeof createFakeApi>) => api.requests.map((entry) => `${entry.method} ${entry.path}`);
const unauthenticated = () => createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') });
const withRole = (role: 'administrator' | 'editor' | 'read_only') =>
  createFakeApi({ [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } }) });

/** W-19 with its body loaded (the body is a chunk of its own, so the h1 comes first). */
async function renderPage(path = '/privacy', api = unauthenticated()) {
  const result = await renderPanel(path, api);
  await screen.findByRole('heading', { level: 2, name: 'Pomoc' });
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('W-19 in the panel (EVM-063 AC1, AC5)', () => {
  it('EVM-063 AC1 the account menu has "Prywatność i pomoc" above "Wyloguj" and opens W-19 inside the shell', async () => {
    const user = userEvent.setup();
    await renderPanel('/work-orders');
    await user.click(screen.getByRole('button', { name: 'Konto: Anna Testowa' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Prywatność i pomoc', 'Wyloguj']);
    await user.click(screen.getByRole('menuitem', { name: 'Prywatność i pomoc' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Prywatność i pomoc' });
    expect(document.title).toBe('Prywatność i pomoc · EVia Manager');
    expect(within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole('link', { name: 'Zlecenia' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it.each(['administrator', 'editor', 'read_only'] as const)(
    'EVM-063 AC5 the role %s sees W-19 in the layout of the panel',
    async (role) => {
      const api = withRole(role);
      await renderPanel('/privacy', api);
      expect(await screen.findByRole('heading', { level: 2, name: 'Pomoc' })).toBeTruthy();
      expect(screen.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Główna nawigacja' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
      // the page itself asks for nothing: only the session of the layout
      expect(new Set(requestsOf(api))).toEqual(new Set([SESSION_REQUEST]));
    },
  );

  it('EVM-063 AC5 a limited session (mfa_enrollment) is led to W-03, not shown the panel', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => json(200, ENROLLMENT_SESSION) });
    await renderPanel('/privacy', api, { heading: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Skonfiguruj drugi krok logowania' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Prywatność i pomoc' })).toBeNull();
  });
});

describe('W-19 before logging in (EVM-063 AC1, AC5; SR-AUTHZ-05, TM-10)', () => {
  it('EVM-063 AC5 without a session the page shows the public layout: no Sidebar, no TopBar, one request (the session)', async () => {
    const api = unauthenticated();
    const { history } = await renderPanel('/privacy', api);
    expect(history.location.pathname).toBe('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Prywatność i pomoc' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Konto:/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(document.body.textContent).not.toContain('Anna Testowa');
    expect(requestsOf(api)).toEqual([SESSION_REQUEST]);
    // way back: a plain link to the login page, nothing carried along (SR-WEB-06)
    expect(screen.getByRole('link', { name: 'Wróć do logowania' }).getAttribute('href')).toBe('/login');
  });

  it('EVM-063 AC5 a failure of the session read that leaves no answer is never the layout of the panel', async () => {
    const api = createFakeApi({ [SESSION_ROUTE]: () => problem(500, 'internal_error') });
    await renderPage('/privacy', api);
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Konto:/ })).toBeNull();
  });

  it('EVM-063 AC5 an ended session: W-19 opened afterwards shows nothing of the earlier one (SR-SESS-05, TM-10)', async () => {
    const queryClient = createQueryClient();
    const api = createFakeApi({
      [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION),
      'GET /api/v1/work-orders': () => json(200, { items: [], nextCursor: null }),
      'GET /api/v1/catalog/work-order-templates': () => json(200, { items: [], nextCursor: null }),
    });
    const { history } = await renderPanel('/work-orders', api, { queryClient });
    expect(screen.getByRole('button', { name: 'Konto: Anna Testowa' })).toBeTruthy();
    api.set(SESSION_ROUTE, () => problem(401, 'session_expired'));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    });
    await waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
    await act(async () => {
      history.push('/privacy');
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Prywatność i pomoc' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Konto:/ })).toBeNull();
    expect(document.body.textContent).not.toContain('Anna Testowa');
    expect(screen.getByRole('link', { name: 'Wróć do logowania' }).getAttribute('href')).toBe('/login');
  });

  it('EVM-063 AC1 W-01 has "Prywatność · Pomoc" in the footer with fixed anchors, also when the address carries a returnTo', async () => {
    await renderPanel('/login?returnTo=https%3A%2F%2Fevil.test', unauthenticated());
    const footer = screen.getByRole('navigation', { name: 'Prywatność i pomoc' });
    expect(within(footer).getByRole('link', { name: 'Prywatność' }).getAttribute('href')).toBe('/privacy#prywatnosc');
    expect(within(footer).getByRole('link', { name: 'Pomoc' }).getAttribute('href')).toBe('/privacy#pomoc');
    expect(footer.textContent).not.toMatch(/evil|returnTo/);
    expect(document.body.textContent).not.toContain('Anna Testowa');
  });

  it('EVM-063 AC1 the footer link of W-01 opens W-19 without a session and focus lands on the heading of the section', async () => {
    const user = userEvent.setup();
    const api = unauthenticated();
    const { history } = await renderPanel('/login', api);
    await user.click(screen.getByRole('link', { name: 'Pomoc' }));
    const help = await screen.findByRole('heading', { level: 2, name: 'Pomoc' });
    expect(history.location.pathname).toBe('/privacy');
    await waitFor(() => {
      expect(document.activeElement).toBe(help);
    });
    expect(new Set(requestsOf(api))).toEqual(new Set([SESSION_REQUEST]));
  });
});

describe('content of W-19 (EVM-063 AC2, AC3, AC6)', () => {
  it('EVM-063 AC3 "Pomoc" comes first, shows no address while none is configured and no link to the instruction (EVM-066)', async () => {
    await renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Pomoc', 'Prywatność']);
    expect(screen.getByText('Kontakt z administratorem: zapytaj przełożonego.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Zgłaszanie utraty sprzętu' }).textContent).toContain('zgłoś to od razu przełożonemu');
    expect(screen.queryByRole('link', { name: /mailto|@/ })).toBeNull();
    expect(screen.queryByText(/Instrukcja dla biura/)).toBeNull();
    expect(screen.queryByText(/Problem z logowaniem/)).toBeNull();
    // a notice about lost equipment is content, not an error: nothing is announced
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-063 AC2 three clauses with a version and a date, collapsed; the controller is a visible marker for the owner to fill in', async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(screen.getByRole('heading', { level: 3, name: 'Administrator danych' })).toBeTruthy();
    expect(screen.getByText('Nazwa:').nextElementSibling?.textContent).toBe('[DO UZUPEŁNIENIA]');
    expect(screen.getByText(/Projekt treści/)).toBeTruthy();
    const titles = [
      'Klauzula dla klientów (do przekazania klientom)',
      'Klauzula dla osób kontaktowych stron',
      'Klauzula dla pracowników i pracy na prywatnym telefonie (BYOD)',
    ];
    for (const title of titles) {
      const toggle = screen.getByRole('button', {
        name: new RegExp(`^${title.replaceAll(/[()]/g, '\\$&')}\\s*Wersja 0\\.1 \\(projekt\\) · obowiązuje od \\[DO UZUPEŁNIENIA\\]$`),
      });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.closest('h3')).toBeTruthy();
    }
    const employees = screen.getByRole('button', { name: /^Klauzula dla pracowników/ });
    await user.click(employees);
    expect(employees.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { level: 4, name: 'Praca na prywatnym telefonie lub komputerze' })).toBeTruthy();
    expect(screen.getByText(/Aplikacja mobilna dla techników jest planowana na późniejszy etap/)).toBeTruthy();
    // expanding is a state of the tab only: nothing is stored (SR-WEB-05)
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('EVM-063 AC6 headings are in order: one h1, h2 sections, h3 clauses, h4 inside clauses; the page has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = await renderPage('/privacy', createFakeApi({ [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION) }));
    for (const toggle of screen.getAllByRole('button', { name: /^Klauzula/ })) await user.click(toggle);
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      expect((levels[index] ?? 0) - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
    expect(await axeViolations(container, { bestPractice: true })).toEqual([]);
  });

  it('EVM-063 AC6 public layout has no axe violations', async () => {
    const { container } = await renderPage();
    expect(await axeViolations(container, { bestPractice: true })).toEqual([]);
  });

  it('EVM-063 AC6 an address with an unknown fragment is ignored: focus goes to the title, nothing throws', async () => {
    await renderPanel('/privacy#x"],[y', unauthenticated());
    const heading = screen.getByRole('heading', { level: 1, name: 'Prywatność i pomoc' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('EVM-063 AC2 #prywatnosc moves focus to the heading of the section', async () => {
    await renderPanel('/privacy#prywatnosc', unauthenticated());
    const heading = await screen.findByRole('heading', { level: 2, name: 'Prywatność' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });
});

describe('states of the content (EVM-063 AC6)', () => {
  function renderSections(load: Parameters<typeof LoadedSections>[0]['load']) {
    return render(
      <I18nextProvider i18n={createI18n()}>
        <LoadedSections {...(load === undefined ? {} : { load })} />
      </I18nextProvider>,
    );
  }

  it('EVM-063 AC6 while the text loads: a skeleton with a status, no sections yet', () => {
    renderSections(() => new Promise(() => undefined));
    expect(screen.getByRole('status').textContent).toBe('Ładowanie treści…');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('EVM-063 AC6 offline and not loaded: "Treść wymaga połączenia." with a retry that loads the content', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let attempts = 0;
    renderSections(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
        : Promise.resolve({ default: () => <p>Treść</p> });
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Treść wymaga połączenia.' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Treść')).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('EVM-063 AC6 online and not loaded: "Nie udało się wczytać strony." without technical details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderSections(() => Promise.reject(new TypeError('boom https://cdn.example/chunk.js')));
    expect(await screen.findByRole('heading', { level: 2, name: 'Nie udało się wczytać strony.' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/boom|cdn|chunk/);
  });
});
