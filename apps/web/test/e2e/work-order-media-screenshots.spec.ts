import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base } from './fixtures.ts';
import { createOrder, installBucket, openMediaTab, photo } from './media-support.ts';
import { seedUnfinished } from './mock-media.ts';

// Screenshots for the UX review of EVM-044 (styleguide § 7.2 pkt 3) — evidence, not visual assertions (ADR-0015).
// Target: docs/ux/reviews/EVM-044 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirMedia']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];
const ME = '11111111-1111-4111-8111-111111111111';

test.describe('UX review screenshots (EVM-044) @screenshots', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-044 W-09 Media i dokumenty: the empty tab, the dialog, the queue, the result, the banner and the verdicts at ${px} px`, async ({
      page,
      api,
      shot,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const bucket = await installBucket(page, api);
      let release: () => void = () => undefined;
      bucket.hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const id = await createOrder(page);
      await openMediaTab(page);
      await expect(page.getByText('To zlecenie nie ma jeszcze zdjęć.')).toBeVisible();
      await shot(`w09-empty-${px}`);

      await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
      const dialog = page.getByRole('dialog');
      await shot(`w09-dialog-source-${px}`);
      await dialog
        .getByLabel('Wybrane pliki')
        .setInputFiles([
          { name: 'plan.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
          photo('IMG_0401.jpg', 4_100_000),
          photo('IMG_0402.jpg', 3_800_000),
        ]);
      await expect(dialog.getByText('Pominięto 1 plik:')).toBeVisible();
      await shot(`w09-dialog-chosen-${px}`);

      await dialog.getByRole('button', { name: 'Wyślij 2 pliki' }).click();
      await expect(page.getByRole('progressbar', { name: 'Postęp wysyłania pliku IMG_0401.jpg' })).toBeVisible();
      await shot(`w09-sending-${px}`);
      release();
      await expect(page.getByText('Wysłano 2 zdjęcia', { exact: false })).toBeVisible();
      await shot(`w09-done-${px}`);

      for (const name of ['IMG_0412.jpg', 'IMG_0413.jpg', 'IMG_0414.jpg']) seedUnfinished(api.media, id, ME, name, 2048);
      await page.reload();
      await expect(page.getByText('Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.')).toBeVisible();
      await shot(`w09-unfinished-banner-${px}`);

      await page.getByRole('button', { name: 'Wybierz ponownie z galerii' }).click();
      await page
        .getByRole('dialog')
        .getByLabel('Wybrane pliki')
        .setInputFiles([photo('IMG_0412.jpg')]);
      api.media.verdict = 'quarantined';
      await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
      await expect(page.getByText('Wymaga uwagi').first()).toBeVisible();
      api.media.verdict = 'checksum_mismatch';
      await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
      await page
        .getByRole('dialog')
        .getByLabel('Wybrane pliki')
        .setInputFiles([photo('IMG_0500.jpg')]);
      await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
      await expect(page.getByText('Nie wysłano — plik uszkodzony w transmisji')).toBeVisible();
      await shot(`w09-verdicts-${px}`);
    });
  }

  test('EVM-044 W-09 Tylko odczyt at 1280 px', async ({ page, api, shot }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await createOrder(page);
    api.role = 'read_only';
    await page.reload();
    await openMediaTab(page);
    await expect(page.getByText('Zdjęcia dodaje Administrator albo Edytor.')).toBeVisible();
    await shot('w09-read-only-1280');
  });
});
