import { violations } from './axe.ts';
import { expect, test } from './fixtures.ts';
import { createOrder, openMediaTab } from './media-support.ts';
import { seedQuarantined } from './mock-media.ts';

// axe-core is injected as a script, which the strict CSP rightly blocks — only this spec bypasses it.
test.use({ bypassCSP: true, baseURL: 'http://localhost:4173', session: 'active' });

const WIDTHS = [360, 768, 1280, 1440];

test.describe('accessibility of the quarantine in "Media i dokumenty", with colour contrast (EVM-049 AC1, AC5, AC6; WCAG 2.2 AA)', () => {
  for (const width of WIDTHS) {
    const px = String(width);

    test(`EVM-049 AC1 AC5 AC6 the tiles held and purged, the filter and the empty filter at ${px} px`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await createOrder(page);
      seedQuarantined(api.media, id, 'held', 'malware_detected');
      seedQuarantined(api.media, id, 'purged');
      await page.reload();
      await openMediaTab(page);
      await expect(page.getByRole('button', { name: 'Wymaga uwagi (1)' })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole('button', { name: 'Wymaga uwagi (1)' }).click();
      await expect(page.getByRole('button', { name: 'Wymaga uwagi (1)' })).toHaveAttribute('aria-pressed', 'true');
      expect(await violations(page)).toEqual([]);

      // the file leaves the quarantine (a clean verdict of the rescan): the filter has nothing to show
      api.media.media.forEach((entry) => {
        entry.quarantine = null;
        entry.state = 'ready';
      });
      await page.getByRole('button', { name: /^Skanuj ponownie/ }).click();
      await expect(page.getByText('Brak plików wymagających uwagi.')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
