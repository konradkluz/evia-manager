import type { MediaAsset } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFailureText } from '../src/work-orders/media-viewer.tsx';
import { ApiError } from '../src/api/client.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, type Handler } from './api-fake.ts';
import { THUMBNAIL_HOST, asset, mediaApi } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 lightbox and the download of the original (EVM-045 AC1, AC2, AC4, AC5, AC6, AC8).
const PATH = `/work-orders/${ORDER_ID}`;
const READ_ONLY = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' as const } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const ready = (n: number, extra: Partial<MediaAsset> = {}) => asset(n, { fileState: 'ready', ...extra });

type Variant = 'thumbnail' | 'preview' | 'original';

/** Answers by the variant of the body: the address says which variant it is for. */
const byVariant =
  (answers: Partial<Record<Variant, Handler>> = {}): Handler =>
  (request) => {
    const variant = (parseBody(request.body) as { variant: Variant }).variant;
    const id = request.path.split('/').at(-2) ?? '';
    return (
      answers[variant]?.(request) ??
      json(200, { url: `${THUMBNAIL_HOST}/media/${id}/${variant}.webp?X-Amz-Signature=sig`, expiresAt: '2026-10-11T12:05:00.000Z' })
    );
  };

async function openGallery(options: Parameters<typeof mediaApi>[0] = {}) {
  const api = mediaApi({ downloadUrl: byVariant(), ...options });
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

const variants = (api: ReturnType<typeof mediaApi>) =>
  api.requests
    .filter((entry) => entry.path.endsWith('/download-url'))
    .map((entry) => (parseBody(entry.body) as { variant: string }).variant);

async function openFirst() {
  const tiles = await screen.findAllByRole('button', { name: /^Powiększ: Zdjęcie/ });
  await userEvent.click(tiles[0] as HTMLElement);
  return await screen.findByRole('dialog', { name: /\(1 z / });
}

describe('EVM-045 AC1 the lightbox', () => {
  it('EVM-045 AC1 a click on a tile opens the preview with Poprzednie / Następne, zoom buttons and the metadata, without a panel of EXIF / GPS or a copy-link action', async () => {
    const api = await openGallery({
      assets: [ready(1, { origin: 'mobile', capturedAt: '2026-10-02T07:12:00.000Z', description: 'Trasa kabla' }), ready(2), ready(3)],
    });
    const dialog = await openFirst();
    await waitFor(() => {
      expect(within(dialog).getByRole('img').getAttribute('src')).toMatch(/\/preview\.webp\?/);
    });
    expect(variants(api)).toContain('preview');
    expect(within(dialog).getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer');
    for (const name of ['Poprzednie', 'Następne', 'Powiększ', 'Pomniejsz', 'Zamknij'])
      expect(within(dialog).getByRole('button', { name })).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Poprzednie' }).disabled).toBe(true);
    expect(within(dialog).getByText(/W trakcie prac · zrobione 02\.10\.2026, \d{1,2}:\d\d · z telefonu/)).toBeTruthy();
    expect(within(dialog).getByText('Opis: Trasa kabla')).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/EXIF|GPS|Kopiuj/i);
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Następne' }));
    expect(await screen.findByRole('dialog', { name: /\(2 z 3\)/ })).toBeTruthy();
    await waitFor(() => {
      expect(variants(api).filter((variant) => variant === 'preview')).toHaveLength(2);
    });
  });

  it('EVM-045 AC1 Esc closes the lightbox and the focus goes back to the tile', async () => {
    await openGallery({ assets: [ready(1), ready(2)] });
    const tile = (await screen.findAllByRole('button', { name: /^Powiększ: Zdjęcie/ }))[0] as HTMLElement;
    tile.focus();
    await userEvent.click(tile);
    const dialog = await screen.findByRole('dialog', { name: /\(1 z 2\)/ });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /\(1 z 2\)/ })).toBeNull();
    });
    expect(document.activeElement).toBe(tile);
  });

  it('EVM-045 AC1 the preview address is not kept in the storage of the browser', async () => {
    await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toBeTruthy();
    });
    const everything = [localStorage, sessionStorage]
      .map((storage) => Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i) ?? '') ?? '').join(' '))
      .join(' ');
    expect(everything).not.toContain('X-Amz');
  });
});

describe('EVM-045 AC2 the download of the original', () => {
  const spyAnchor = () => {
    const clicked: Array<{ href: string; rel: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, rel: this.rel, target: this.target });
    });
    return clicked;
  };

  it('EVM-045 AC2 the Editor gets the warning and, after confirming, the original by an anchor without a referrer; the page stays', async () => {
    const clicked = spyAnchor();
    const api = await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    expect(within(ask).getByText('Plik może zawierać metadane, np. lokalizację. Do udostępnienia poza firmą użyj podglądu.')).toBeTruthy();
    expect(variants(api)).not.toContain('original');
    expect(await axeViolations(ask)).toEqual([]);
    await userEvent.click(within(ask).getByRole('button', { name: 'Pobierz oryginał' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(variants(api)).toContain('original');
    expect(clicked[0]?.href).toMatch(/\/original\.webp\?/);
    expect(clicked[0]?.rel).toContain('noreferrer');
    expect(clicked[0]?.target).toBe('');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Pobrać oryginał?' })).toBeNull();
    });
  });

  it('EVM-045 AC2 "Pobierz podgląd" in the dialog gets the preview in a new tab and no original is asked for', async () => {
    const clicked = spyAnchor();
    const api = await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Pobierz podgląd' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.target).toBe('_blank');
    expect(clicked[0]?.rel).toContain('noreferrer');
    expect(variants(api)).not.toContain('original');
  });

  it('EVM-045 AC2 "Anuluj" asks for nothing', async () => {
    const clicked = spyAnchor();
    const api = await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Anuluj' }));
    expect(clicked).toHaveLength(0);
    expect(variants(api)).not.toContain('original');
  });
});

describe('EVM-045 AC4 Tylko odczyt', () => {
  it('EVM-045 AC4 Tylko odczyt sees the preview and has no button of the original', async () => {
    await openGallery({ session: READ_ONLY, assets: [ready(1)] });
    const dialog = await openFirst();
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toBeTruthy();
    });
    expect(within(dialog).queryByRole('button', { name: 'Pobierz oryginał' })).toBeNull();
  });
});

describe('EVM-045 AC5 limits', () => {
  it('EVM-045 AC5 429 for the original is "Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min." in the dialog', async () => {
    await openGallery({
      assets: [ready(1)],
      downloadUrl: byVariant({ original: () => problem(429, 'rate_limited', {}, { 'Retry-After': '300' }) }),
    });
    const dialog = await openFirst();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Pobierz oryginał' }));
    expect(await within(ask).findByText('Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.')).toBeTruthy();
  });

  it('EVM-045 AC5 429 for the preview says the same instead of the picture', async () => {
    await openGallery({ assets: [ready(1)], downloadUrl: byVariant({ preview: () => problem(429, 'rate_limited') }) });
    const dialog = await openFirst();
    expect(await within(dialog).findByText('Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.')).toBeTruthy();
  });

  it('EVM-045 AC5 the texts of the failures: 404, 429, 403 and the rest', () => {
    expect(downloadFailureText(new ApiError(404, { code: 'not_found' }))).toBe('Nie znaleziono pliku. Mógł zostać usunięty.');
    expect(downloadFailureText(new ApiError(429, { code: 'rate_limited' }))).toContain('Spróbuj ponownie za 5 min');
    expect(downloadFailureText(new ApiError(403, { code: 'forbidden' }))).toBe('Nie masz uprawnień do pobrania tego pliku.');
    expect(downloadFailureText(new ApiError(500, { code: 'x' }))).toBe('Nie udało się pobrać pliku. Spróbuj ponownie.');
    expect(downloadFailureText(new Error('boom'))).toBe('Nie udało się pobrać pliku. Spróbuj ponownie.');
  });
});

describe('EVM-045 AC8 the states of the lightbox', () => {
  it('EVM-045 AC8 while the preview is awaited there is a Skeleton with a text, and the zoom is disabled', async () => {
    await openGallery({ assets: [ready(1)], downloadUrl: byVariant({ preview: () => new Promise<Response>(() => undefined) }) });
    const dialog = await openFirst();
    expect(within(dialog).getByText('Wczytywanie podglądu')).toBeTruthy();
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Powiększ' }).disabled).toBe(true);
  });

  it('EVM-045 AC8 a file deleted in the meantime (404) is "Nie znaleziono pliku. Mógł zostać usunięty."', async () => {
    await openGallery({ assets: [ready(1)], downloadUrl: byVariant({ preview: () => problem(404, 'not_found') }) });
    const dialog = await openFirst();
    expect(await within(dialog).findByText('Nie znaleziono pliku. Mógł zostać usunięty.')).toBeTruthy();
  });

  it('EVM-045 AC8 another failure of the preview is "Nie można wyświetlić"', async () => {
    await openGallery({ assets: [ready(1)], downloadUrl: byVariant({ preview: () => problem(500, 'internal_error') }) });
    const dialog = await openFirst();
    expect(await within(dialog).findByText('Nie można wyświetlić')).toBeTruthy();
  });

  it('EVM-045 AC8 a picture of the preview that fails to load is "Nie można wyświetlić"', async () => {
    await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    const image = await waitFor(() => {
      const found = within(dialog).getByRole('img');
      expect(found.getAttribute('src')).toMatch(/preview/);
      return found;
    });
    fireEvent.error(image);
    expect(await within(dialog).findByText('Nie można wyświetlić')).toBeTruthy();
  });

  it('EVM-045 AC8 offline the download of the original is disabled with a hint', async () => {
    await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toBeTruthy();
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(await within(dialog).findByText('Brak połączenia — pobieranie jest wyłączone do jego powrotu.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-045 AC8 offline a preview not loaded yet asks for nothing and is fetched when the connection is back', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const api = await openGallery({ assets: [ready(1)] });
    const dialog = await openFirst();
    expect(await within(dialog).findByText('Brak połączenia — podgląd wczyta się po jego powrocie.')).toBeTruthy();
    expect(variants(api)).not.toContain('preview');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => {
      expect(within(dialog).getByRole('img')).toBeTruthy();
    });
  });

  it('EVM-045 AC8 a failure of the original (403) is told in the dialog and the dialog stays', async () => {
    await openGallery({ assets: [ready(1)], downloadUrl: byVariant({ original: () => problem(403, 'forbidden') }) });
    const dialog = await openFirst();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Pobierz oryginał' }));
    expect(await within(ask).findByText('Nie masz uprawnień do pobrania tego pliku.')).toBeTruthy();
  });
});
