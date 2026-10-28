import { expect, test } from './fixtures.ts';
import { createOrder, installBucket, openMediaTab, photo } from './media-support.ts';
import { seedUnfinished } from './mock-media.ts';

// "Media i dokumenty" of an order in a real browser against the synthetic API and a synthetic bucket (EVM-044 AC1–AC8): the upload of
// photos in parts straight to the bucket, the files that never leave the tab, the verdicts of the scan, the unfinished uploads after a
// closed tab, the role. Real S3 (SeaweedFS) and ClamAV (EICAR) are covered by the API integration tests (Testcontainers).
test.use({ session: 'active' });

const ME = '11111111-1111-4111-8111-111111111111';

test.describe('upload of photos (EVM-044)', () => {
  test('EVM-044 AC1 AC6 three photos go to the bucket in signed PUTs without cookies, end as "Wysłano", and the browser keeps nothing', async ({
    page,
    api,
  }) => {
    const bucket = await installBucket(page, api);
    await createOrder(page);
    await openMediaTab(page);
    await expect(page.getByText('To zlecenie nie ma jeszcze zdjęć.')).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dodaj zdjęcia lub filmy' });
    await dialog.getByLabel('Wybrane pliki').setInputFiles([photo('IMG_0412.jpg'), photo('IMG_0413.jpg'), photo('IMG_0414.jpg')]);
    await expect(dialog.getByText('Wybrano 3 pliki')).toBeVisible();
    await dialog.getByLabel('Kategoria').selectOption({ label: 'W trakcie prac' });
    await dialog.getByRole('button', { name: 'Wyślij 3 pliki' }).click();

    await expect(page.getByText('Wysłano 3 zdjęcia — możesz je usunąć z telefonu. Potem opróżnij kosz galerii.')).toBeVisible();
    expect(bucket.puts).toHaveLength(3);
    // SR-WEB-04: the request to the bucket carries no cookie and no CSRF token; the body is the part
    for (const put of bucket.puts) {
      expect(put.headers['cookie']).toBeUndefined();
      expect(put.headers['x-csrf-token']).toBeUndefined();
      expect(put.size).toBe(2048);
    }
    expect(api.media.completes).toBe(3);
    const created = api.seen.filter((entry) => entry.method === 'POST' && entry.url.endsWith('/media-assets'));
    expect(created).toHaveLength(1);
    expect(created[0]?.headers['x-csrf-token']).toBe('csrf-active');
    expect(JSON.parse(created[0]?.postData ?? '{}')).toMatchObject({
      items: [{ category: 'in_progress', fileName: 'IMG_0412.jpg' }, {}, {}],
    });
    // SR-WEB-05: no files, names or addresses in the storage of the browser
    const stores = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
      caches: (await caches.keys()).length,
    }));
    expect(stores).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
  });

  test('EVM-044 AC1 AC6 the CSP lets the page reach the one origin of the bucket and no other', async ({ page }) => {
    const response = await page.goto('/work-orders');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("connect-src 'self' https://bucket.e2e.test;");
    expect(csp).not.toContain('*');
  });

  test('EVM-044 AC2 SVG, HTML and an archive never leave the tab; the rest of the choice is sent', async ({ page, api }) => {
    await installBucket(page, api);
    await createOrder(page);
    await openMediaTab(page);
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Wybrane pliki')
      .setInputFiles([
        { name: 'plan.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
        { name: 'strona.html', mimeType: 'text/html', buffer: Buffer.from('<html/>') },
        { name: 'archiwum.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') },
        photo('dobre.jpg'),
      ]);
    await expect(dialog.getByText('Pominięto 3 pliki:')).toBeVisible();
    await expect(dialog.getByText('Plik „plan.svg” ma nieobsługiwany format.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Wyślij 1 plik' }).click();
    await expect(page.getByText('Wysłano 1 zdjęcie', { exact: false })).toBeVisible();
    expect(api.media.media.map((entry) => entry.fileName)).toEqual(['dobre.jpg']);
  });

  test('EVM-044 AC3 a file held by the scan is "Wymaga uwagi" with no reason and no way to open it', async ({ page, api }) => {
    await installBucket(page, api);
    api.media.verdict = 'quarantined';
    await createOrder(page);
    await openMediaTab(page);
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Wybrane pliki')
      .setInputFiles([photo('eicar.jpg')]);
    await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
    await expect(page.getByText('Wymaga uwagi', { exact: true })).toBeVisible();
    await expect(page.getByText('Nie usuwaj tego pliku z telefonu. Administrator został powiadomiony.')).toBeVisible();
    await expect(page.getByText(/malware|type_mismatch/i)).toHaveCount(0);
  });

  test('EVM-044 AC5 a checksum mismatch says the file was damaged and "Ponów" sends it again from the memory of the tab', async ({
    page,
    api,
  }) => {
    const bucket = await installBucket(page, api);
    api.media.verdict = 'checksum_mismatch';
    await createOrder(page);
    await openMediaTab(page);
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Wybrane pliki')
      .setInputFiles([photo('IMG_0412.jpg')]);
    await page.getByRole('dialog').getByRole('button', { name: 'Wyślij 1 plik' }).click();
    await expect(page.getByText('Nie wysłano — plik uszkodzony w transmisji')).toBeVisible();
    api.media.verdict = 'clean';
    await page.getByRole('button', { name: 'Ponów wysyłanie: IMG_0412.jpg' }).click();
    await expect(page.getByText('Wysłano 1 zdjęcie', { exact: false })).toBeVisible();
    expect(bucket.puts).toHaveLength(2);
    expect(api.media.sessionsCreated).toBe(2);
  });

  test('EVM-044 AC4 after the tab was closed the banner names the unfinished files and choosing them again resumes the sessions', async ({
    page,
    api,
  }) => {
    const bucket = await installBucket(page, api);
    const id = await createOrder(page);
    for (const name of ['IMG_0412.jpg', 'IMG_0413.jpg', 'IMG_0414.jpg']) seedUnfinished(api.media, id, ME, name, 2048);
    await page.reload();
    const banner = page.getByRole('region', { name: 'Niedokończone wysyłanie zdjęć' });
    await expect(banner.getByText('Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.')).toBeVisible();
    // the newest first, as the list of the API is
    await expect(banner.getByText('IMG_0414.jpg · IMG_0413.jpg · IMG_0412.jpg')).toBeVisible();
    await banner.getByRole('button', { name: 'Wybierz ponownie z galerii' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Wybrane pliki').setInputFiles([photo('IMG_0412.jpg'), photo('IMG_0413.jpg'), photo('IMG_0414.jpg')]);
    await dialog.getByRole('button', { name: 'Wyślij 3 pliki' }).click();
    await expect(page.getByText('Wysłano 3 zdjęcia', { exact: false })).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(bucket.puts).toHaveLength(3);
    expect(api.media.sessionsCreated).toBe(0);
    expect(api.media.media).toHaveLength(3);
  });

  test('EVM-044 AC7 Tylko odczyt sees the list and no Uploader', async ({ page, api }) => {
    await createOrder(page);
    api.role = 'read_only';
    await page.reload();
    await openMediaTab(page);
    await expect(page.getByText('Zdjęcia dodaje Administrator albo Edytor.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Wybierz pliki' })).toHaveCount(0);
  });

  test('EVM-044 AC8 a slow network shows the state of each file and "Wstrzymaj" holds one of them', async ({ page, api }) => {
    const bucket = await installBucket(page, api);
    let release: () => void = () => undefined;
    bucket.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await createOrder(page);
    await openMediaTab(page);
    await page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Wybrane pliki').setInputFiles([photo('IMG_0412.jpg'), photo('IMG_0413.jpg')]);
    await dialog.getByRole('button', { name: 'Wyślij 2 pliki' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Wysyłanie · 0 z 2' })).toBeVisible();
    await expect(page.getByText('Nie zamykaj karty do końca wysyłania.', { exact: false })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Postęp wysyłania pliku IMG_0412.jpg' })).toBeVisible();
    await expect(page.getByText('W kolejce')).toBeVisible();
    await page.getByRole('button', { name: 'Wstrzymaj wysyłanie: IMG_0413.jpg' }).click();
    await expect(page.getByText('Wstrzymano')).toBeVisible();
    release();
    await expect(page.getByRole('heading', { level: 3, name: 'Wysyłanie · 1 z 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Wznów wysyłanie: IMG_0413.jpg' }).click();
    await expect(page.getByText('Wysłano 2 zdjęcia', { exact: false })).toBeVisible();
  });
});
