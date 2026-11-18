import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { openLightbox, openVideoLightbox } from './media-support.ts';

// The preview of a photo in the lightbox of W-09 in a real browser (EVM-045 AC1): the picture is fitted to the window when it opens
// (all of it visible, proportions kept) and the zoom buttons step from the fit and back to it. jsdom lays nothing out, so the geometry is
// asserted here (the helper `openLightbox` serves an SVG of the natural size given in place of the WebP of the server).
test.use({ session: 'active' });

const boxes = async (dialog: Locator) => {
  const image = await dialog.getByRole('img').boundingBox();
  const area = await dialog.getByRole('region', { name: 'Powiększone zdjęcie' }).boundingBox();
  if (image === null || area === null) throw new Error('the picture or its area is not laid out');
  return { image, area };
};

const SIZES = [
  { name: 'landscape 1600 x 1200', width: 1600, height: 1200 },
  { name: 'portrait 1200 x 1600', width: 1200, height: 1600 },
];
const WINDOWS = [
  { px: '1440 x 900', width: 1440, height: 900 },
  { px: '1280 x 800', width: 1280, height: 800 },
  { px: '1280 x 500 (a low window)', width: 1280, height: 500 },
  { px: '768 x 1024', width: 768, height: 1024 },
  { px: '360 x 640', width: 360, height: 640 },
];

test.describe('EVM-045 AC1 the preview of a photo is fitted to the window', () => {
  for (const size of SIZES) {
    for (const window of WINDOWS) {
      test(`EVM-045 AC1 the ${size.name} photo opens whole, in its proportions, in ${window.px}`, async ({ page, api }) => {
        await page.setViewportSize({ width: window.width, height: window.height });
        const dialog = await openLightbox(page, api, size.width, size.height);
        const { image, area } = await boxes(dialog);
        // all of the picture is visible: it lies inside the area (the padding of the area is outside the picture), no scrolling is needed
        expect(image.x).toBeGreaterThanOrEqual(area.x - 0.5);
        expect(image.y).toBeGreaterThanOrEqual(area.y - 0.5);
        expect(image.x + image.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
        expect(image.y + image.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
        const scrolls = await dialog
          .getByRole('region', { name: 'Powiększone zdjęcie' })
          .evaluate((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
        expect(scrolls).toBe(false);
        // the proportions are kept and the photo is not drawn larger than its natural size
        expect(image.width / image.height).toBeCloseTo(size.width / size.height, 1);
        expect(image.width).toBeLessThanOrEqual(size.width + 0.5);
        expect(image.height).toBeLessThanOrEqual(size.height + 0.5);
      });
    }
  }

  test('EVM-045 AC1 a photo smaller than the window is not enlarged', async ({ page, api }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openLightbox(page, api, 600, 400);
    const { image } = await boxes(dialog);
    expect(Math.round(image.width)).toBe(600);
    expect(Math.round(image.height)).toBe(400);
  });

  test('EVM-045 AC1 "Powiększ" steps up from the fit and "Pomniejsz" steps back to it, where it is disabled', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openLightbox(page, api, 1600, 1200);
    const zoomIn = dialog.getByRole('button', { name: 'Powiększ' });
    const zoomOut = dialog.getByRole('button', { name: 'Pomniejsz' });
    const fit = (await boxes(dialog)).image;
    await expect(zoomOut).toBeDisabled();
    await expect(zoomIn).toBeEnabled();

    const widths = [fit.width];
    for (let step = 0; step < 3; step += 1) {
      await zoomIn.click();
      widths.push((await boxes(dialog)).image.width);
    }
    await expect(zoomIn).toBeDisabled();
    await expect(zoomOut).toBeEnabled();
    expect(widths[1]).toBeCloseTo(fit.width * 1.5, 0);
    expect(widths[2]).toBeCloseTo(fit.width * 2, 0);
    expect(widths[3]).toBeCloseTo(fit.width * 3, 0);
    await expect(dialog.getByText('Powiększenie 300%')).toBeAttached();

    for (let step = 0; step < 3; step += 1) await zoomOut.click();
    const back = (await boxes(dialog)).image;
    expect(back.width).toBeCloseTo(fit.width, 0);
    expect(back.height).toBeCloseTo(fit.height, 0);
    await expect(zoomOut).toBeDisabled();
  });
});

// The player of a film in the same lightbox (EVM-046 AC4): the film keeps its proportions and the whole player (the picture and the control
// bar) lies inside the area, so the controls are visible without scrolling; the film has no zoom.
const FILMS = [
  { name: 'landscape 1920 x 1080', width: 1920, height: 1080 },
  { name: 'portrait 1080 x 1920', width: 1080, height: 1920 },
];

test.describe('EVM-046 AC4 the preview of a film fits the area of the lightbox', () => {
  for (const film of FILMS) {
    for (const window of WINDOWS.filter((value) => value.width !== 1440 && value.width !== 768)) {
      test(`EVM-046 AC4 the ${film.name} film is whole inside the area, in its proportions, in ${window.px}`, async ({ page, api }) => {
        await page.setViewportSize({ width: window.width, height: window.height });
        const dialog = await openVideoLightbox(page, api, film.width, film.height);
        const area = dialog.getByRole('region', { name: 'Powiększone zdjęcie' });
        const player = await dialog.locator('video').boundingBox();
        const frame = await area.boundingBox();
        if (player === null || frame === null) throw new Error('the player or its area is not laid out');
        expect(player.x).toBeGreaterThanOrEqual(frame.x - 0.5);
        expect(player.y).toBeGreaterThanOrEqual(frame.y - 0.5);
        expect(player.x + player.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
        expect(player.y + player.height).toBeLessThanOrEqual(frame.y + frame.height + 0.5);
        expect(
          await area.evaluate(
            (element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
          ),
        ).toBe(false);
        expect(player.width / player.height).toBeCloseTo(film.width / film.height, 1);
        // the zoom is for photos only
        await expect(dialog.getByRole('button', { name: 'Powiększ' })).toBeDisabled();
      });
    }
  }
});
