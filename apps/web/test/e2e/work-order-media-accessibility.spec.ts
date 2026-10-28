import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { createOrder, installBucket, openMediaTab, photo } from './media-support.ts';
import { seedUnfinished } from './mock-media.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const ME = '11111111-1111-4111-8111-111111111111';

test.describe('accessibility of the tab "Media i dokumenty" in the browser, with colour contrast (EVM-044 AC1–AC5, AC7, AC8; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-044 AC1 AC2 AC8 the empty tab, the dialog with chosen and refused files and the queue with every state at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const bucket = await installBucket(page, api);
      let release: () => void = () => undefined;
      bucket.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      await createOrder(page);
      await openMediaTab(page);
      await expect(page.getByText('To zlecenie nie ma jeszcze zdjęć.')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByLabel('Wybrane pliki')
        .setInputFiles([
          { name: 'plan.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
          photo('IMG_0412.jpg'),
          photo('IMG_0413.jpg'),
        ]);
      await expect(dialog.getByText('Pominięto 1 plik:')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await dialog.getByRole('button', { name: 'Wyślij 2 pliki' }).click();
      await expect(page.getByRole('progressbar', { name: 'Postęp wysyłania pliku IMG_0412.jpg' })).toBeVisible();
      await page.getByRole('button', { name: 'Wstrzymaj wysyłanie: IMG_0413.jpg' }).click();
      await expect(page.getByText('Wstrzymano')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      release();
      await page.getByRole('button', { name: 'Wznów wysyłanie: IMG_0413.jpg' }).click();
      await expect(page.getByText('Wysłano 2 zdjęcia', { exact: false })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test(`EVM-044 AC3 AC4 AC5 the banner of the unfinished uploads, the file held by the scan and the damaged file at ${px} px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await installBucket(page, api);
      const id = await createOrder(page);
      for (const name of ['IMG_0412.jpg', 'IMG_0413.jpg', 'IMG_0414.jpg']) seedUnfinished(api.media, id, ME, name, 2048);
      await page.reload();
      await expect(page.getByText('Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.')).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Wybierz ponownie z galerii' }).click();
      await page
        .getByRole('dialog')
        .getByLabel('Wybrane pliki')
        .setInputFiles([photo('IMG_0412.jpg')]);
      api.media.verdict = 'quarantined';
      await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
      await expect(page.getByText('Wymaga uwagi', { exact: true })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      api.media.verdict = 'checksum_mismatch';
      await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
      await page
        .getByRole('dialog')
        .getByLabel('Wybrane pliki')
        .setInputFiles([photo('IMG_0500.jpg')]);
      await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
      await expect(page.getByText('Nie wysłano — plik uszkodzony w transmisji')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }

  test('EVM-044 AC7 Tylko odczyt has no violations at 360 px', async ({ page, api }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await createOrder(page);
    api.role = 'read_only';
    await page.reload();
    await openMediaTab(page);
    await expect(page.getByText('Zdjęcia dodaje Administrator albo Edytor.')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
