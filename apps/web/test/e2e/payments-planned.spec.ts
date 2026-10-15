import { expect, test } from './fixtures.ts';
import { answerPlanned, planned } from './mock-planned.ts';

// W-11 "Do wystawienia" in a real browser (EVM-059 AC1, AC5): the chip, the rows of planned instalments and the address with the view only.
// The list of the view is answered here by a route (the shared synthetic server holds only invoiced instalments); the policy of the
// real server is covered by the API tests. The screenshots are evidence for the UX review (ADR-0015): docs/ux/reviews/EVM-059 (PNG ignored by git).
test.use({ session: 'active' });

test.describe('W-11 "Do wystawienia" (EVM-059)', () => {
  test('EVM-059 AC1 the chip shows the planned instalments, the address carries only the view', async ({ page }) => {
    await answerPlanned(page, [planned(1), planned(2, { name: 'Płatność końcowa', sharePercent: null, amount: null })]);
    await page.goto('/payments');
    await page.getByRole('button', { name: 'Do wystawienia', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Płatności — do wystawienia' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Transze do wystawienia faktury' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Wystaw fakturę: Zaliczka, ZL-2026-0001' })).toBeVisible();
    await expect(page.getByText('Brak kwoty')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?view=planned');
    await expect(page).toHaveTitle('Płatności · EVia Manager');
  });

  test('EVM-059 AC5 nothing to invoice: "Wszystkie transze mają wystawione faktury."', async ({ page }) => {
    await answerPlanned(page, []);
    await page.goto('/payments?view=planned');
    await expect(page.getByRole('heading', { level: 2, name: 'Wszystkie transze mają wystawione faktury.' })).toBeVisible();
  });

  test('EVM-059 AC4 Tylko odczyt sees the filter without the action', async ({ page, api }) => {
    api.role = 'read_only';
    await answerPlanned(page, [planned(1)]);
    await page.goto('/payments?view=planned');
    await expect(page.getByRole('table', { name: 'Transze do wystawienia faktury' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Wystaw fakturę/ })).toHaveCount(0);
  });
});
