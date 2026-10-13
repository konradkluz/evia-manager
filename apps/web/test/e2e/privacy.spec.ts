import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { DISPLAY_NAME } from './mock-api.ts';
import { watchPage } from './support.ts';

// W-19 "Prywatność i pomoc" in the browser (EVM-063 AC1–AC6): the real panel under the real strict CSP, with and without
// a session, against the synthetic API of mock-api.ts. No dependency on the time of day.
test.use({ baseURL: 'http://localhost:4173', session: 'none' });

const ORIGIN = 'http://localhost:4173';

/** What the tab keeps in the browser (SR-WEB-05, ASVS V14.3.3): storages, databases and cookies. */
async function storages(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    return JSON.stringify({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases,
      cookie: document.cookie,
    });
  });
}

const EMPTY_STORAGES = JSON.stringify({ local: [], session: [], databases: [], cookie: '' });

test.describe('W-19 before logging in (EVM-063 AC1, AC4, AC5)', () => {
  test('EVM-063 AC1 the footer of W-01 opens W-19 without a session: public layout, one request, no violation, nothing stored', async ({
    page,
    api,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/login?returnTo=%2Fwork-orders');
    const footer = page.getByRole('navigation', { name: 'Prywatność i pomoc' });
    await expect(footer.getByRole('link', { name: 'Prywatność' })).toHaveAttribute('href', '/privacy#prywatnosc');
    await expect(footer.getByRole('link', { name: 'Pomoc' })).toHaveAttribute('href', '/privacy#pomoc');
    await footer.getByRole('link', { name: 'Pomoc' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/privacy#pomoc`);
    await expect(page).toHaveTitle('Prywatność i pomoc · EVia Manager');
    const help = page.getByRole('heading', { level: 2, name: 'Pomoc' });
    await expect(help).toBeFocused();
    await expect(page.getByRole('heading', { level: 1, name: 'Prywatność i pomoc' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Konto:/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Wróć do logowania' })).toHaveAttribute('href', '/login');
    await expect(page.getByText(DISPLAY_NAME)).toHaveCount(0);
    // the only call of the page is the read of the session, which answers 401
    expect(api.seen.filter((entry) => entry.url.includes('/api/'))).toEqual([
      expect.objectContaining({ method: 'GET', url: expect.stringContaining('/api/v1/auth/session') }),
    ]);
    expect(await storages(page)).toBe(EMPTY_STORAGES);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-063 AC2 the clauses open and close with the keyboard; the state is not stored and the controller data are visible markers', async ({
    page,
  }) => {
    const problems = await watchPage(page, ORIGIN);
    await page.goto('/privacy#prywatnosc');
    await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeFocused();
    await expect(page.getByText('Nazwa:')).toBeVisible();
    const clients = page.getByRole('button', { name: /^Klauzula dla klientów/ });
    await expect(clients).toHaveAttribute('aria-expanded', 'false');
    await clients.focus();
    await page.keyboard.press('Enter');
    await expect(clients).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { level: 4, name: 'Komu przekazujemy dane' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(clients).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    expect(await storages(page)).toBe(EMPTY_STORAGES);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Klauzula dla klientów/ })).toHaveAttribute('aria-expanded', 'false');
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });

  test('EVM-063 AC6 offline with the content not yet loaded: "Treść wymaga połączenia." and no technical details', async ({
    page,
    context,
  }) => {
    await page.goto('/login');
    await context.setOffline(true);
    await page.getByRole('navigation', { name: 'Prywatność i pomoc' }).getByRole('link', { name: 'Pomoc' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Treść wymaga połączenia.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Prywatność i pomoc' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spróbuj ponownie' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wróć do logowania' })).toBeVisible();
    await expect(page.getByText('Brak połączenia.')).toBeVisible();
  });

  test('EVM-063 AC6 offline with the content loaded: the text stays, the banner says there is no connection', async ({ page, context }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Pomoc' })).toBeVisible();
  });
});

test.describe('W-19 in the panel for every role (EVM-063 AC1, AC5)', () => {
  test.use({ session: 'active' });
  for (const role of ['administrator', 'editor', 'read_only'] as const) {
    test(`EVM-063 AC5 the role ${role} opens W-19 from the account menu on any screen, in the layout of the panel`, async ({
      page,
      api,
    }) => {
      api.role = role;
      const problems = await watchPage(page, ORIGIN);
      await page.goto('/customers');
      await expect(page.getByRole('heading', { level: 1, name: 'Klienci' })).toBeVisible();
      await page.getByRole('button', { name: `Konto: ${DISPLAY_NAME}` }).click();
      await page.getByRole('menuitem', { name: 'Prywatność i pomoc' }).click();
      await expect(page).toHaveURL(`${ORIGIN}/privacy`);
      await expect(page.getByRole('heading', { level: 1, name: 'Prywatność i pomoc' })).toBeFocused();
      await expect(page.getByRole('heading', { level: 2, name: 'Pomoc' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Prywatność' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Wróć do logowania' })).toHaveCount(0);
      expect(await storages(page)).toBe(EMPTY_STORAGES);
      expect(await problems.cspViolations()).toEqual([]);
      expect(problems.foreignRequests).toEqual([]);
    });
  }

  test('EVM-063 AC1 an address with #pomoc opened in the panel moves focus to the section heading', async ({ page }) => {
    await page.goto('/privacy#pomoc');
    await expect(page.getByRole('heading', { level: 2, name: 'Pomoc' })).toBeFocused();
  });
});
