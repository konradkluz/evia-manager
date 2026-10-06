import { expect, test } from '@playwright/test';
import { panelSecurityHeaders } from '../../security-headers.ts';

const expected = Object.fromEntries(
  Object.entries(panelSecurityHeaders({ variant: 'strict' })).map(([name, value]) => [name.toLowerCase(), value]),
);

test.describe('panel security headers (EVM-008 AC4)', () => {
  test('EVM-008 AC4 panel sends security headers and the strict CSP on the document and on assets', async ({ page, request }) => {
    const document = await page.goto('/work-orders');
    expect(document?.status()).toBe(200);
    expect(document?.headers()).toMatchObject(expected);
    expect(document?.headers()['strict-transport-security']).toBeUndefined();

    const script = await page.locator('script[type="module"]').getAttribute('src');
    const asset = await request.get(script ?? '');
    expect(asset.status()).toBe(200);
    expect(asset.headers()).toMatchObject(expected);
    expect(asset.headers()['x-powered-by']).toBeUndefined();
    // No source maps in the production build (SR-INFRA-06).
    expect(await asset.text()).not.toContain('sourceMappingURL');
  });
});
