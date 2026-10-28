import type { Page, Route } from '@playwright/test';
import { expect } from './fixtures.ts';
import type { MockApi } from './mock-api.ts';
import { BUCKET_ORIGIN } from './mock-media.ts';

/** Creates the order ZL-2026-0042 through W-05 and returns its id (the same steps as the other specs of W-06). */
export async function createOrder(page: Page): Promise<string> {
  await page.goto('/work-orders/new');
  await page.getByRole('combobox', { name: 'Klient' }).fill('Lodz');
  await page.getByRole('option', { name: /Jan Przykładowy/ }).click();
  await page.getByRole('combobox', { name: 'Lokalizacja' }).fill('testowa');
  await page.getByRole('option', { name: /ul\. Testowa 7/ }).click();
  await page.getByRole('radio', { name: /Garaż — pełny proces/ }).check();
  await page.getByRole('button', { name: 'Utwórz zlecenie' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

export async function openMediaTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Media i dokumenty' })).toBeVisible();
}

/** Synthetic JPEG-like payload (the panel looks at the name and the type; the server checks the content in the API tests). */
export const photo = (name: string, size = 2048) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.alloc(size, 1) });

export interface Bucket {
  /** The requests the bucket received: part, headers (no cookie may be there) and size of the body. */
  readonly puts: { readonly part: number; readonly headers: Record<string, string>; readonly size: number }[];
  /** While `hold` is set the parts are not answered (a slow network): resolve it to let them through. */
  hold: Promise<void> | null;
}

/**
 * The private bucket as the panel's browser sees it: the signed `PUT` of a part is answered with an `ETag` (and the CORS headers the
 * real bucket has for the origin of the panel). The part is also confirmed in the synthetic API (`ListParts`). Real S3 is in the API tests.
 */
export async function installBucket(page: Page, api: MockApi): Promise<Bucket> {
  const bucket: Bucket = { puts: [], hold: null };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Allow-Methods': 'PUT' };
  await page.route(`${BUCKET_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const part = Number(url.searchParams.get('partNumber'));
    const session = url.searchParams.get('uploadId') ?? '';
    bucket.puts.push({ part, headers: await request.allHeaders(), size: request.postDataBuffer()?.length ?? 0 });
    if (bucket.hold !== null) await bucket.hold;
    api.media.parts.get(session)?.add(part);
    return route.fulfill({ status: 200, headers: { ...cors, ETag: '"e2e-etag"' } });
  });
  return bucket;
}
