import { expect, test } from '@playwright/test';
import { watchPage } from './support.ts';

test.describe('panel smoke (EVM-008 AC5)', () => {
  test('EVM-008 AC5 smoke: open the panel and see the empty state "Brak zleceń"', async ({ page, baseURL }) => {
    const problems = await watchPage(page, new URL(baseURL ?? '').origin);
    await page.goto('/');
    await expect(page).toHaveURL(/\/work-orders$/);
    await expect(page).toHaveTitle('Zlecenia · EVia Manager');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { level: 1, name: 'Zlecenia' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
    await expect(page.getByText('Zlecenia pojawią się tutaj, gdy zostaną dodane do systemu.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nowe zlecenie' })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(nav.getByRole('link', { name: 'Zlecenia' })).toHaveAttribute('aria-current', 'page');
    // Styles come from the token theme (the stylesheet is loaded under the strict CSP).
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    expect(problems.console).toEqual([]);
    expect(problems.page).toEqual([]);
    expect(await problems.cspViolations()).toEqual([]);
    expect(problems.foreignRequests).toEqual([]);
  });
});
