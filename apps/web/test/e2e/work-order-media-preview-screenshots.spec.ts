import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test as base } from './fixtures.ts';
import { openLightbox, openVideoLightbox } from './media-support.ts';

// Screenshots for the UX review of the preview of a photo (EVM-045 AC1, W-09 lightbox, styleguide § 3.11) — evidence, not visual assertions
// (ADR-0015). Target: docs/ux/reviews/EVM-045 (PNG ignored by git); run: pnpm --filter @evia/web run e2e:screenshots
const test = base.extend<{ shot: (name: string) => Promise<void> }>({
  shot: async ({ page }, use, testInfo) => {
    const dir = String(testInfo.project.metadata['uxReviewDirPreview']);
    mkdirSync(dir, { recursive: true });
    await use(async (name) => {
      await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
    });
  },
});

test.use({ session: 'active' });

const WIDTHS = [
  { px: 360, height: 640 },
  { px: 768, height: 1024 },
  { px: 1280, height: 800 },
  { px: 1440, height: 900 },
];
const PHOTOS = [
  { name: 'landscape', width: 1600, height: 1200 },
  { name: 'portrait', width: 1200, height: 1600 },
];

test.describe('UX review screenshots (EVM-045) @screenshots', () => {
  for (const window of WIDTHS) {
    for (const photo of PHOTOS) {
      test(`EVM-045 AC1 W-09 the lightbox: the ${photo.name} preview fitted and after one "Powiększ" at ${String(window.px)} px`, async ({
        page,
        api,
        shot,
      }) => {
        await page.setViewportSize({ width: window.px, height: window.height });
        const dialog = await openLightbox(page, api, photo.width, photo.height);
        await shot(`w09-lightbox-${photo.name}-fit-${String(window.px)}`);
        await dialog.getByRole('button', { name: 'Powiększ' }).click();
        await shot(`w09-lightbox-${photo.name}-zoom-${String(window.px)}`);
      });
    }
  }

  for (const window of [WIDTHS[0], WIDTHS[2]]) {
    for (const film of [
      { name: 'landscape', width: 1920, height: 1080 },
      { name: 'portrait', width: 1080, height: 1920 },
    ]) {
      test(`EVM-046 AC4 W-09 the lightbox: the ${film.name} film fitted at ${String(window?.px)} px`, async ({ page, api, shot }) => {
        await page.setViewportSize({ width: window?.px ?? 1280, height: window?.height ?? 800 });
        await openVideoLightbox(page, api, film.width, film.height);
        await shot(`w09-lightbox-film-${film.name}-${String(window?.px)}`);
      });
    }
  }
});
