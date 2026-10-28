import { expect, test } from './fixtures.ts';
import { createOrder, openMediaTab } from './media-support.ts';
import { seedQuarantined } from './mock-media.ts';

// The quarantine in "Media i dokumenty" in a real browser against the synthetic API (EVM-049 AC1, AC3, AC5, AC6, AC8). W-04 and the
// answers of the API are covered by the component tests; the real scan (ClamAV, EICAR) and the retention by the API integration tests.
test.use({ session: 'active' });

test.describe('quarantine of files (EVM-049)', () => {
  test('EVM-049 AC1 AC6 Administrator sees the reason and "Skanuj ponownie", the filter shows only the files held', async ({
    page,
    api,
  }) => {
    const id = await createOrder(page);
    seedQuarantined(api.media, id, 'held', 'malware_detected');
    seedQuarantined(api.media, id, 'purged');
    await page.reload();
    await openMediaTab(page);
    const list = page.getByRole('list', { name: 'Media i dokumenty' });
    await expect(list.getByText('Skan wykrył zagrożenie', { exact: false })).toBeVisible();
    await expect(list.getByText('Plik usunięty po 30 dniach kwarantanny')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Skanuj ponownie/ })).toHaveCount(1);

    await page.getByRole('button', { name: 'Wymaga uwagi (1)' }).click();
    await expect(page.getByRole('button', { name: 'Wymaga uwagi (1)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByText('Plik usunięty po 30 dniach kwarantanny')).toHaveCount(0);
    await page.getByRole('button', { name: 'Wszystkie' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
  });

  test('EVM-049 AC3 "Skanuj ponownie" sends the request and the file goes back to the check', async ({ page, api }) => {
    const id = await createOrder(page);
    seedQuarantined(api.media, id, 'held', 'type_mismatch');
    await page.reload();
    await openMediaTab(page);
    await expect(page.getByText('Typ pliku niezgodny z rozszerzeniem', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /^Skanuj ponownie/ }).click();
    await expect.poll(() => api.media.rescans).toBe(1);
    const sent = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/rescan'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(sent[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    // the list after 202 says `scanning`: "Sprawdzanie pliku", the confirmation and no second click
    await expect(page.getByRole('status').filter({ hasText: 'Plik jest skanowany ponownie' })).toBeVisible();
    await expect(page.getByText('Sprawdzanie pliku')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Skanuj ponownie/ })).toHaveCount(0);
  });

  test('EVM-049 AC1 AC8 Edytor sees the plain text with no reason and no action', async ({ page, api }) => {
    const id = await createOrder(page);
    seedQuarantined(api.media, id, 'held', 'malware_detected');
    api.role = 'editor';
    await page.reload();
    await openMediaTab(page);
    await expect(page.getByText('Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.')).toBeVisible();
    await expect(page.getByText('Skan wykrył zagrożenie', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Skanuj ponownie/ })).toHaveCount(0);
  });
});
