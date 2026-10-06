import { expect, test } from './fixtures.ts';

test.describe('keyboard and responsive shell (EVM-008 AC3, WCAG 2.2 AA)', () => {
  test('EVM-008 AC3 the skip link is the first focusable element and moves focus to the content', async ({ page }) => {
    await page.goto('/work-orders');
    // The shell appears once the session is read; Tab before that has nothing to focus.
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Przejdź do treści' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('EVM-008 AC3 at 360 px the "Menu" button opens the drawer; Esc closes it and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/work-orders');
    await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toBeHidden();
    const menu = page.getByRole('button', { name: 'Menu' });
    const box = await menu.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Główna nawigacja' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Zamknij menu' })).toBeFocused();
    await expect(drawer.getByRole('link', { name: 'Zlecenia' })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    // No horizontal scrolling at the minimum width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('EVM-008 AC3 at 768 px the sidebar is collapsed and shows the item name as a tooltip on keyboard focus', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto('/work-orders');
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    await expect(nav).toBeVisible();
    expect((await nav.boundingBox())?.width).toBe(72);
    await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
    const label = nav.getByText('Zlecenia');
    await expect(label).toHaveCSS('opacity', '0');
    await nav.getByRole('link', { name: 'Zlecenia' }).focus();
    await expect(label).toHaveCSS('opacity', '1');
  });

  test('EVM-008 AC3 at 768 px the tooltip closes with Esc while focus stays on the link (WCAG 1.4.13)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto('/work-orders');
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    const link = nav.getByRole('link', { name: 'Zlecenia' });
    const label = nav.getByText('Zlecenia');
    await link.focus();
    await expect(label).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(label).toHaveCSS('opacity', '0');
    await expect(link).toBeFocused();
  });

  test('EVM-008 AC3 at 768 px the tooltip stays visible when the pointer moves onto it (WCAG 1.4.13)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto('/work-orders');
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    const link = nav.getByRole('link', { name: 'Zlecenia' });
    const label = nav.getByText('Zlecenia');
    await link.hover();
    await expect(label).toHaveCSS('opacity', '1');
    const linkBox = await link.boundingBox();
    const labelBox = await label.boundingBox();
    if (!linkBox || !labelBox) throw new Error('missing layout boxes');
    // Move the pointer horizontally from the link, across the gap, onto the tooltip.
    const y = labelBox.y + labelBox.height / 2;
    await page.mouse.move(linkBox.x + linkBox.width - 1, y);
    await page.mouse.move(labelBox.x + 2, y, { steps: 5 });
    await expect(label).toHaveCSS('opacity', '1');
  });

  test('EVM-008 AC3 at 1280 px the sidebar is expanded with the product name and the visible label', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/work-orders');
    const nav = page.getByRole('navigation', { name: 'Główna nawigacja' });
    expect((await nav.boundingBox())?.width).toBe(256);
    await expect(nav.getByText('EVia Manager')).toBeVisible();
    await expect(nav.getByText('Zlecenia')).toHaveCSS('opacity', '1');
  });

  test('EVM-008 AC3 offline: the banner appears and the empty state stays visible', async ({ page, context }) => {
    await page.goto('/work-orders');
    await context.setOffline(true);
    await expect(page.getByText('Brak połączenia. Panel działa po jego powrocie.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('Brak połączenia. Panel działa po jego powrocie.')).toHaveCount(0);
  });
});
