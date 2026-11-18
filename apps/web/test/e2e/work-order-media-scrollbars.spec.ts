import { expect, test } from './fixtures.ts';
import { openLightbox } from './media-support.ts';

// Classic scrollbars (about 17 px, as in the office browsers on Windows) take room from the scrolling area of the lightbox when the picture
// is zoomed. The fit is measured on the outer size of the area, so the steps stay exact multiples of the fit (EVM-045 AC1). Headless
// browsers hide the scrollbars by default, so this spec starts them as classic ones (and the test checks that they really are there).
test.use({
  session: 'active',
  launchOptions: {
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test('EVM-045 AC1 classic scrollbars after "Powiększ" do not change the fitted size: 200% is exactly twice the fit', async ({
  page,
  api,
  browserName,
}) => {
  // headless Firefox keeps overlay scrollbars whatever the prefs (checked: 0 px taken); the unit test of the Lightbox covers the measuring
  test.skip(browserName === 'firefox', 'headless Firefox cannot be made to show classic scrollbars');
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await openLightbox(page, api, 1600, 1200);
  // a constructed stylesheet (the CSP of the panel forbids an inline <style>): a fixed width of the bars, where the browser allows it
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('*::-webkit-scrollbar { width: 17px; height: 17px; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  const area = dialog.getByRole('region', { name: 'Podgląd zdjęcia' });
  const image = async () => {
    const box = await dialog.getByRole('img').boundingBox();
    if (box === null) throw new Error('the picture is not laid out');
    return box;
  };
  const fit = await image();
  await dialog.getByRole('button', { name: 'Powiększ' }).click();
  await dialog.getByRole('button', { name: 'Powiększ' }).click();
  // the precondition: the scrollbars take room (otherwise the test would prove nothing)
  const bar = await area.evaluate((element: HTMLElement) => element.offsetWidth - element.clientWidth);
  expect(bar).toBeGreaterThan(0);
  const zoomed = await image();
  expect(Math.abs(zoomed.width - 2 * fit.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(zoomed.height - 2 * fit.height)).toBeLessThanOrEqual(1);
});
