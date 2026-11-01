import { expect, test } from './fixtures.ts';
import { createOrder, installBucket, openMediaTab, photo } from './media-support.ts';

// The stage at the upload of photos in a real browser (EVM-048 AC1): the list offers the stages of THIS order and the chosen one travels with the
// media. The edit of the metadata and the grouping are covered by the component tests (the synthetic API has no ready gallery).
test.use({ session: 'active' });

test.describe('stage of the media (EVM-048)', () => {
  test('EVM-048 AC1 the dialog offers the stages of the order and the chosen stage is sent with the photo', async ({ page, api }) => {
    await installBucket(page, api);
    await createOrder(page);
    await openMediaTab(page);
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj zdjęcia lub filmy' });
    await dialog.getByLabel('Wybrane pliki').setInputFiles([photo('IMG_0500.jpg')]);
    const stage = dialog.getByRole('combobox', { name: 'Etap (opcjonalnie)' });
    await expect(stage.getByRole('option', { name: 'Bez etapu' })).toBeAttached();
    await expect(stage.getByRole('option', { name: 'Warunki przyłączenia' })).toBeAttached();
    await stage.selectOption({ label: 'Warunki przyłączenia' });
    const selected = await stage.inputValue();
    await dialog.getByLabel('Opis (opcjonalnie)').fill('<script>window.__evm048 = 1</script> Rozdzielnica');
    await dialog.getByRole('button', { name: 'Wyślij 1 plik' }).click();
    await expect(page.getByText('Wysłano 1 zdjęcie', { exact: false })).toBeVisible();
    const created = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/media-assets'));
    expect(JSON.parse(created[0]?.postData ?? '{}')).toMatchObject({ items: [{ procedureStageId: selected }] });
    // the typed description never becomes markup (SR-WEB-03)
    expect(await page.evaluate(() => (window as unknown as { __evm048?: number }).__evm048)).toBeUndefined();
    expect(await page.locator('script', { hasText: '__evm048' }).count()).toBe(0);
  });
});
