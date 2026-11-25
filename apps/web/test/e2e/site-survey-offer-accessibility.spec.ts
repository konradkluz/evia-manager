import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { openDocuments, sendOffer } from './survey-offer-support.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

for (const width of [360, 768, 1280, 1440]) {
  const px = String(width);
  test(`EVM-148 AC6 the offer form, the refusal in the panel and the rejected survey have no axe violations at ${px} px`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDocuments(page);
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Dodaj dokument' }).click();
    await expect(page.getByRole('dialog', { name: 'Dodaj dokument' }).getByText('Dane osobowe w ofercie')).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Anuluj' }).click();
    api.surveys.documentRefusal = 'customer_required';
    await sendOffer(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Najpierw przypisz klienta' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    api.surveys.status = 'cancelled';
    await page.reload();
    await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
    await expect(page.getByRole('button', { name: 'Dodaj dokument' })).toHaveAttribute('aria-disabled', 'true');
    expect(await violations(page)).toEqual([]);
  });
}
