import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { openLightbox, openVideoLightbox } from './media-support.ts';

// The preview of a photo in the lightbox of W-09 in a real browser (EVM-045 AC1): the picture is fitted to the window when it opens
// (all of it visible, proportions kept) and the zoom buttons step from the fit and back to it. jsdom lays nothing out, so the geometry is
// asserted here (the helper `openLightbox` serves an SVG of the natural size given in place of the WebP of the server).
test.use({ session: 'active' });

const boxes = async (dialog: Locator) => {
  const image = await dialog.getByRole('img').boundingBox();
  const area = await dialog.getByRole('region', { name: 'Podgląd zdjęcia' }).boundingBox();
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
          .getByRole('region', { name: 'Podgląd zdjęcia' })
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

  test('EVM-045 AC1 a disabled "Pomniejsz" looks disabled: its icon colour differs from the enabled "Powiększ"', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openLightbox(page, api, 1600, 1200);
    const colour = (name: string) => dialog.getByRole('button', { name }).evaluate((element) => getComputedStyle(element).color);
    await expect(dialog.getByRole('button', { name: 'Pomniejsz' })).toBeDisabled();
    expect(await colour('Pomniejsz')).not.toBe(await colour('Powiększ'));
    await dialog.getByRole('button', { name: 'Powiększ' }).click();
    // enabled at 150%: the same colour as "Powiększ"
    expect(await colour('Pomniejsz')).toBe(await colour('Powiększ'));
  });
});

// The zoom scales the picture itself: the scrolling area is exactly the picture (no empty strips from the fit margins) and the view stays on
// the same point of the picture. The geometry is read from the scrolling area (its scroll size, its position) and the picture in it.
const view = (dialog: Locator) =>
  dialog.getByRole('region', { name: 'Podgląd zdjęcia' }).evaluate((area) => {
    const image = area.querySelector('img');
    if (image === null) throw new Error('no picture');
    const box = image.getBoundingClientRect();
    const frame = area.getBoundingClientRect();
    return {
      scrollWidth: area.scrollWidth,
      scrollHeight: area.scrollHeight,
      clientWidth: area.clientWidth,
      clientHeight: area.clientHeight,
      scrollLeft: area.scrollLeft,
      scrollTop: area.scrollTop,
      imageWidth: box.width,
      imageHeight: box.height,
      // the picture in the coordinates of the scrolled content
      imageLeft: box.left - frame.left + area.scrollLeft,
      imageTop: box.top - frame.top + area.scrollTop,
    };
  });

type View = Awaited<ReturnType<typeof view>>;

/** The point of the picture (0..1 of each side) in the middle of the view. */
const centreOf = (state: View) => ({
  x: (state.scrollLeft + state.clientWidth / 2 - state.imageLeft) / state.imageWidth,
  y: (state.scrollTop + state.clientHeight / 2 - state.imageTop) / state.imageHeight,
});

test.describe('EVM-045 AC1 the zoom scales the picture and keeps the view on its middle', () => {
  const zoomWindows = [
    { px: '1280 x 800', width: 1280, height: 800 },
    { px: '360 x 640', width: 360, height: 640 },
  ];
  for (const size of SIZES) {
    for (const window of zoomWindows) {
      test(`EVM-045 AC1 the ${size.name} photo in ${window.px}: the scrolling area is the picture, the view is on its middle, the steps go back`, async ({
        page,
        api,
      }) => {
        await page.setViewportSize({ width: window.width, height: window.height });
        const dialog = await openLightbox(page, api, size.width, size.height);
        const zoomIn = dialog.getByRole('button', { name: 'Powiększ' });
        const zoomOut = dialog.getByRole('button', { name: 'Pomniejsz' });
        const fit = await view(dialog);
        for (const factor of [1.5, 2, 3]) {
          await zoomIn.click();
          const state = await view(dialog);
          // the picture is the fitted size times the factor and the scrolling area is exactly it
          expect(state.imageWidth).toBeCloseTo(fit.imageWidth * factor, 0);
          expect(state.imageHeight).toBeCloseTo(fit.imageHeight * factor, 0);
          expect(Math.abs(state.scrollWidth - Math.max(state.imageWidth, state.clientWidth))).toBeLessThanOrEqual(2);
          expect(Math.abs(state.scrollHeight - Math.max(state.imageHeight, state.clientHeight))).toBeLessThanOrEqual(2);
          // no empty strip before the picture: where it is larger than the area it starts at the start of the content
          if (state.imageWidth > state.clientWidth) expect(state.imageLeft).toBeLessThanOrEqual(1);
          if (state.imageHeight > state.clientHeight) expect(state.imageTop).toBeLessThanOrEqual(1);
          // the middle of the view is on the middle of the picture
          const centre = centreOf(state);
          expect(centre.x).toBeCloseTo(0.5, 1);
          expect(centre.y).toBeCloseTo(0.5, 1);
        }
        await expect(zoomIn).toBeDisabled();
        // back by the steps: the fit again, no scrolling
        for (let step = 0; step < 3; step += 1) await zoomOut.click();
        const back = await view(dialog);
        expect(back.imageWidth).toBeCloseTo(fit.imageWidth, 0);
        expect(back.imageHeight).toBeCloseTo(fit.imageHeight, 0);
        expect(back.scrollWidth).toBeLessThanOrEqual(back.clientWidth + 1);
        expect(back.scrollHeight).toBeLessThanOrEqual(back.clientHeight + 1);
        expect([back.scrollLeft, back.scrollTop]).toEqual([0, 0]);
      });
    }
  }

  test('EVM-045 AC1 two "Powiększ" and two "Pomniejsz" return to the starting view; the point in the middle is kept on the way', async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openLightbox(page, api, 1600, 1200);
    const area = dialog.getByRole('region', { name: 'Podgląd zdjęcia' });
    const zoomIn = dialog.getByRole('button', { name: 'Powiększ' });
    const zoomOut = dialog.getByRole('button', { name: 'Pomniejsz' });
    const start = await view(dialog);
    await zoomIn.click();
    // move the view off the middle: the point in the middle of the view is the same after the next step
    await area.evaluate((element) => {
      element.scrollTo(40, 30);
    });
    const moved = centreOf(await view(dialog));
    await zoomIn.click();
    const next = centreOf(await view(dialog));
    expect(next.x).toBeCloseTo(moved.x, 1);
    expect(next.y).toBeCloseTo(moved.y, 1);
    await zoomOut.click();
    await zoomOut.click();
    const end = await view(dialog);
    expect(end.imageWidth).toBeCloseTo(start.imageWidth, 0);
    expect(end.imageHeight).toBeCloseTo(start.imageHeight, 0);
    expect([end.scrollLeft, end.scrollTop]).toEqual([0, 0]);
  });

  test('EVM-045 AC1 the arrows of the keyboard scroll the zoomed picture in the area that has the focus', async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openLightbox(page, api, 1600, 1200);
    await dialog.getByRole('button', { name: 'Powiększ' }).click();
    await dialog.getByRole('button', { name: 'Powiększ' }).click();
    await dialog.getByRole('region', { name: 'Podgląd zdjęcia' }).focus();
    const before = await view(dialog);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await view(dialog)).scrollLeft).toBeGreaterThan(before.scrollLeft);
    expect((await view(dialog)).scrollTop).toBeGreaterThan(before.scrollTop);
  });

  test('EVM-045 AC1 a change of the window size at 200% sizes the picture again from the new fit, the view stays in the picture', async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const dialog = await openLightbox(page, api, 1600, 1200);
    await dialog.getByRole('button', { name: 'Powiększ' }).click();
    await dialog.getByRole('button', { name: 'Powiększ' }).click();
    await page.setViewportSize({ width: 800, height: 600 });
    // 200% of the new fit (by the width or by the height of the new area, whichever is smaller)
    await expect
      .poll(async () => {
        const state = await view(dialog);
        const fitWidth = Math.min(state.clientWidth, (state.clientHeight * 1600) / 1200);
        return Math.abs(state.imageWidth - fitWidth * 2) < 1;
      })
      .toBe(true);
    const state = await view(dialog);
    expect(state.imageWidth / state.imageHeight).toBeCloseTo(1600 / 1200, 1);
    expect(Math.abs(state.scrollWidth - Math.max(state.imageWidth, state.clientWidth))).toBeLessThanOrEqual(2);
    expect(state.scrollLeft).toBeLessThanOrEqual(state.scrollWidth - state.clientWidth + 1);
    expect(state.imageLeft).toBeLessThanOrEqual(1);
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
        const area = dialog.getByRole('region', { name: 'Podgląd zdjęcia' });
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
