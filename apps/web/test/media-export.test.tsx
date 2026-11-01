import type { MediaExport } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, type Handler } from './api-fake.ts';
import { EXPORTS_BASE, asset, mediaApi, type MediaServerOptions } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 "Eksportuj zdjęcia (ZIP)" and "Pobierz ZIP" (EVM-052 AC1, AC2, AC5, AC6, AC7).
const PATH = `/work-orders/${ORDER_ID}`;
const EXPORT_ID = '01968f3e-0000-7000-8000-00000e000001';
const role = (value: 'administrator' | 'editor' | 'read_only') => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: value } });
const PHOTOS = [asset(1, { fileState: 'ready' }), asset(2, { fileState: 'ready' })];
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby wyeksportować zdjęcia (ZIP)';
const SIGNED_URL = 'https://exports.example.test/exports/2026/11/file.zip?X-Amz-Signature=sig';

function entry(extra: Partial<MediaExport> = {}): MediaExport {
  return {
    id: EXPORT_ID,
    workOrderId: ORDER_ID,
    state: 'ready',
    fileCount: 48,
    sizeBytes: 123_000_000,
    createdAt: '2026-11-01T09:00:00.000Z',
    readyAt: '2026-11-01T09:01:00.000Z',
    expiresAt: '2026-11-02T09:00:00.000Z',
    ...extra,
  };
}

function stubWebAuthn() {
  const credential = {
    id: 'Y3JlZA',
    rawId: 'Y3JlZA',
    type: 'public-key',
    response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  };
  class Fake {
    static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
    toJSON() {
      return credential;
    }
  }
  vi.stubGlobal('PublicKeyCredential', Fake);
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(() => Promise.resolve(new Fake())) }, configurable: true });
}

async function openMedia(options: MediaServerOptions = {}) {
  const api = mediaApi({ assets: PHOTOS, ...options });
  api.set('POST /api/v1/auth/step-up/options', () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  );
  api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

const created: Handler = () => json(202, { exportId: EXPORT_ID, state: 'queued' });

beforeEach(() => {
  stubWebAuthn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

describe('EVM-052 AC1 the order of an export', () => {
  it('EVM-052 AC1 the Editor confirms the warning about metadata, W-04 follows step_up_required and the same call (same key) is sent again', async () => {
    const order = vi.fn<Handler>();
    order.mockImplementationOnce(() => problem(403, 'step_up_required')).mockImplementation(created);
    let listed: MediaExport[] = [];
    const api = await openMedia({
      session: role('editor'),
      routes: {
        [`POST ${EXPORTS_BASE}`]: (request) => {
          const answer = order(request);
          if ((answer as Response).status === 202) listed = [entry({ state: 'queued' })];
          return answer;
        },
        [`GET ${EXPORTS_BASE}`]: () => json(200, { items: listed }),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Wyeksportować zdjęcia?' });
    expect(within(dialog).getByText(/metadane, np\. lokalizację/)).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eksportuj' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(`POST ${EXPORTS_BASE}`)).toHaveLength(2);
    });
    const [first, second] = api.calls(`POST ${EXPORTS_BASE}`);
    expect(first?.headers.get('Idempotency-Key')).toBeTruthy();
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(
      await screen.findByText('Przygotowujemy plik ZIP. Link pokażemy tutaj, gdy będzie gotowy — będzie ważny 24 godziny i zadziała raz.'),
    ).toBeTruthy();
  });

  it('EVM-052 AC1 a ready export offers "Pobierz ZIP" that warns once more and then opens the signed address once', async () => {
    const link = vi.fn<Handler>(() =>
      json(200, { url: SIGNED_URL, expiresAt: '2026-11-01T09:05:00.000Z' }, { 'Cache-Control': 'no-store' }),
    );
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(this.href);
    });
    const api = await openMedia({
      session: role('administrator'),
      routes: {
        [`GET ${EXPORTS_BASE}`]: () => json(200, { items: [entry()] }),
        [`POST ${EXPORTS_BASE}/${EXPORT_ID}/download-url`]: link,
      },
    });
    expect(await screen.findByText(/Plik ZIP jest gotowy \(48 zdjęć, 123 MB\)/)).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Pobierz ZIP' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pobrać plik ZIP?' });
    expect(within(dialog).getByText(/metadane, np\. lokalizację/)).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz ZIP' }));
    await waitFor(() => {
      expect(opened).toEqual([SIGNED_URL]);
    });
    expect(api.calls(`POST ${EXPORTS_BASE}/${EXPORT_ID}/download-url`)).toHaveLength(1);
    expect(document.body.textContent).not.toContain('X-Amz-Signature');
  });

  it('EVM-052 AC1 an export whose link was issued says it works once and offers no download', async () => {
    await openMedia({ routes: { [`GET ${EXPORTS_BASE}`]: () => json(200, { items: [entry({ state: 'downloaded' })] }) } });
    expect(await screen.findByText(/nie zadziała ponownie/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pobierz ZIP' })).toBeNull();
  });
});

describe('EVM-052 AC2 limits', () => {
  it('EVM-052 AC2 a 429 shows the message of the limit', async () => {
    await openMedia({ routes: { [`POST ${EXPORTS_BASE}`]: () => problem(429, 'export_rate_limited', {}, { 'Retry-After': '600' }) } });
    await userEvent.click(await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyeksportować zdjęcia?' })).getByRole('button', { name: 'Eksportuj' }),
    );
    expect(await screen.findByText('Kolejny eksport możliwy za 10 min (maks. 5 dziennie).')).toBeTruthy();
  });

  it('EVM-052 AC2 a set above the size limit shows the message of the size', async () => {
    await openMedia({ routes: { [`POST ${EXPORTS_BASE}`]: () => problem(429, 'export_too_large') } });
    await userEvent.click(await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyeksportować zdjęcia?' })).getByRole('button', { name: 'Eksportuj' }),
    );
    expect(await screen.findByText('Zdjęcia zlecenia przekraczają limit eksportu (10 GB).')).toBeTruthy();
  });
});

describe('EVM-052 AC5 roles', () => {
  it('EVM-052 AC5 Tylko odczyt sees no button and asks for no exports', async () => {
    const api = await openMedia({ session: role('read_only') });
    expect(screen.queryByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' })).toBeNull();
    expect(api.calls(`GET ${EXPORTS_BASE}`)).toHaveLength(0);
  });

  it('EVM-052 AC5 a refusal of the server (403) is an alert and a cancelled W-04 says "Nie wykonano operacji."', async () => {
    const order = vi.fn<Handler>(() => problem(403, 'forbidden'));
    const api = await openMedia({ routes: { [`POST ${EXPORTS_BASE}`]: order } });
    await userEvent.click(await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyeksportować zdjęcia?' })).getByRole('button', { name: 'Eksportuj' }),
    );
    expect(await screen.findByText('Nie masz uprawnień do eksportu zdjęć.')).toBeTruthy();

    order.mockImplementation(() => problem(403, 'step_up_required'));
    api.set('POST /api/v1/auth/step-up/options', () => problem(500, 'internal_error'));
    await userEvent.click(await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyeksportować zdjęcia?' })).getByRole('button', { name: 'Eksportuj' }),
    );
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: /Anuluj/ }));
    expect(await screen.findByText('Nie wykonano operacji.')).toBeTruthy();
  });
});

describe('EVM-052 AC6 states', () => {
  it('EVM-052 AC6 without photos the button is disabled and says why', async () => {
    await openMedia({ assets: [] });
    const button = await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' });
    expect(button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Eksport jest możliwy, gdy zlecenie ma zdjęcia gotowe do pobrania.')).toBeTruthy();
  });

  it('EVM-052 AC6 offline the button is disabled and says why', async () => {
    await openMedia();
    await screen.findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText('Brak połączenia — eksport jest wyłączony do jego powrotu.')).toBeTruthy();
  });

  it('EVM-052 AC6 a failed job shows the closed message and no detail', async () => {
    await openMedia({
      routes: { [`GET ${EXPORTS_BASE}`]: () => json(200, { items: [entry({ state: 'failed', failureCode: 'storage_unavailable' })] }) },
    });
    expect(await screen.findByText('Nie udało się przygotować pliku. Spróbuj ponownie.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('storage_unavailable');
  });
});

describe('EVM-052 AC7 download', () => {
  it('EVM-052 AC7 a 404 of the link says the file is gone and opens nothing', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await openMedia({
      routes: {
        [`GET ${EXPORTS_BASE}`]: () => json(200, { items: [entry()] }),
        [`POST ${EXPORTS_BASE}/${EXPORT_ID}/download-url`]: () => problem(404, 'not_found'),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pobierz ZIP' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Pobrać plik ZIP?' })).getByRole('button', { name: 'Pobierz ZIP' }),
    );
    expect(await screen.findByText('Plik ZIP nie jest już dostępny. Zleć nowy eksport.')).toBeTruthy();
    expect(click).not.toHaveBeenCalled();
  });
});
