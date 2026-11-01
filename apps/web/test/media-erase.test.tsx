import type { MediaAsset } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, type Handler } from './api-fake.ts';
import { DOCUMENTS_BASE, doc, documentsApi, type DocumentsServerOptions } from './documents-api.ts';
import { MEDIA_BASE, THUMBNAIL_HOST, asset, mediaApi, type MediaServerOptions } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 "Usuń" and "Usuń plik trwale…" of a medium and of a document (EVM-051 AC1, AC2, AC3, AC6, AC7).
const PATH = `/work-orders/${ORDER_ID}`;
const role = (value: 'administrator' | 'editor' | 'read_only') => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: value } });
const ready = (n: number, extra: Partial<MediaAsset> = {}) => asset(n, { fileState: 'ready', ...extra });
const MEDIUM = ready(1, { version: 3 });
const MEDIUM_URL = `${MEDIA_BASE}/${MEDIUM.id}`;
const DOCUMENT = doc(1, { version: 4, title: 'Warunki' });
const DOCUMENT_URL = `${DOCUMENTS_BASE}/${DOCUMENT.id}`;
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby usunąć plik trwale';
const noContent: Handler = () => new Response(null, { status: 204 });
const thumbnails: Handler = (request) =>
  json(200, {
    url: `${THUMBNAIL_HOST}/media/${request.path.split('/').at(-2) ?? ''}/x.webp?X-Amz-Signature=sig`,
    expiresAt: '2026-10-11T12:05:00.000Z',
  });

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

function withStepUp<T extends { set: (route: string, handler: Handler) => void }>(api: T): T {
  api.set('POST /api/v1/auth/step-up/options', () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  );
  api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
  return api;
}

async function openMedia(options: MediaServerOptions = {}) {
  const api = withStepUp(mediaApi({ downloadUrl: thumbnails, ...options }));
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

async function openLightbox() {
  const tiles = await screen.findAllByRole('button', { name: /^Powiększ: Zdjęcie/ });
  await userEvent.click(tiles[0] as HTMLElement);
  return await screen.findByRole('dialog', { name: /\(1 z / });
}

async function openDocuments(options: DocumentsServerOptions = {}) {
  const api = withStepUp(documentsApi(options));
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ });
  return api;
}

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

describe('EVM-051 AC1 AC6 "Usuń" of a medium', () => {
  it('EVM-051 AC1 the Administrator deletes a medium from the lightbox, sees "Usunięto." and "Cofnij" restores it', async () => {
    const restore = vi.fn<Handler>(noContent);
    const api = await openMedia({ assets: [MEDIUM], routes: { [`POST ${MEDIUM_URL}/restore`]: restore } });
    const lightbox = await openLightbox();
    expect(await axeViolations(lightbox)).toEqual([]);
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Usunięto.')).toBeTruthy();
    expect(api.calls(`DELETE ${MEDIUM_URL}`)).toHaveLength(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Przywrócono.')).toBeTruthy();
  });

  it.each(['editor', 'read_only'] as const)('EVM-051 AC6 %s sees neither "Usuń" nor "Usuń plik trwale…"', async (name) => {
    await openMedia({ session: role(name), assets: [MEDIUM] });
    const lightbox = await openLightbox();
    expect(within(lightbox).queryByRole('button', { name: 'Usuń' })).toBeNull();
    expect(within(lightbox).queryByRole('button', { name: 'Usuń plik trwale…' })).toBeNull();
  });

  it('EVM-051 AC7 offline both actions are disabled and say why', async () => {
    await openMedia({ assets: [MEDIUM] });
    const lightbox = await openLightbox();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => {
      expect(within(lightbox).getByRole('button', { name: 'Usuń' }).getAttribute('aria-disabled')).toBe('true');
    });
    expect(within(lightbox).getByRole('button', { name: 'Usuń plik trwale…' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(lightbox).getByText(/Usuwanie jest niedostępne offline/)).toBeTruthy();
  });

  it('EVM-051 AC6 a refusal of the server (403) is an alert, not a success toast', async () => {
    await openMedia({ assets: [MEDIUM], remove: () => problem(403, 'forbidden') });
    const lightbox = await openLightbox();
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń' }));
    expect(await within(lightbox).findByText('Nie masz uprawnień do tej operacji.')).toBeTruthy();
    expect(screen.queryByText('Usunięto.')).toBeNull();
  });
});

describe('EVM-051 AC2 AC3 AC7 "Usuń plik trwale…" of a medium', () => {
  it('EVM-051 AC2 the dialog warns, W-04 follows a 403 step_up_required and the same request goes again with the version in If-Match', async () => {
    const purge = vi.fn<Handler>();
    purge.mockImplementationOnce(() => problem(403, 'step_up_required')).mockImplementation(noContent);
    const api = await openMedia({ assets: [MEDIUM], routes: { [`POST ${MEDIUM_URL}/purge-file`]: purge } });
    const lightbox = await openLightbox();
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń plik trwale…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plik trwale?' });
    expect(within(dialog).getByText(/Tej operacji nie można cofnąć/)).toBeTruthy();
    expect(within(dialog).getByText(/wygasają w ciągu 30 dni/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń plik trwale' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(`POST ${MEDIUM_URL}/purge-file`)).toHaveLength(2);
    });
    for (const call of api.calls(`POST ${MEDIUM_URL}/purge-file`)) expect(call.headers.get('If-Match')).toBe('"3"');
    expect(await screen.findByText('Plik usunięty trwale.')).toBeTruthy();
  });

  it('EVM-051 AC7 cancelling W-04 says "Nie wykonano operacji." and sends nothing more', async () => {
    const purge = vi.fn<Handler>(() => problem(403, 'step_up_required'));
    const api = await openMedia({ assets: [MEDIUM], routes: { [`POST ${MEDIUM_URL}/purge-file`]: purge } });
    api.set('POST /api/v1/auth/step-up/options', () => problem(500, 'internal_error'));
    const lightbox = await openLightbox();
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń plik trwale…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plik trwale?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń plik trwale' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: /Anuluj/ }));
    expect(await screen.findByText('Nie wykonano operacji.')).toBeTruthy();
    expect(api.calls(`POST ${MEDIUM_URL}/purge-file`)).toHaveLength(1);
  });

  it('EVM-051 AC3 a refused deletion register (503) leaves the file alone and says so', async () => {
    await openMedia({
      assets: [MEDIUM],
      routes: { [`POST ${MEDIUM_URL}/purge-file`]: () => problem(503, 'deletion_register_unavailable') },
    });
    const lightbox = await openLightbox();
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń plik trwale…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plik trwale?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń plik trwale' }));
    expect(await within(dialog).findByText(/Plik pozostał bez zmian/)).toBeTruthy();
  });

  it.each([
    ['file_processing', 409, 'Plik jest jeszcze przetwarzany'],
    ['version_conflict', 412, 'Dane zmieniły się w międzyczasie'],
  ])('EVM-051 AC7 %s (%i) has its own words', async (code, status, text) => {
    await openMedia({ assets: [MEDIUM], routes: { [`POST ${MEDIUM_URL}/purge-file`]: () => problem(status, code) } });
    const lightbox = await openLightbox();
    await userEvent.click(within(lightbox).getByRole('button', { name: 'Usuń plik trwale…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plik trwale?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń plik trwale' }));
    expect(await within(dialog).findByText(new RegExp(text))).toBeTruthy();
  });

  it('EVM-051 AC2 an erased medium is a line with the marker, not a tile; no file name, no description, no action on the file', async () => {
    await openMedia({
      assets: [ready(2, { fileErasedAt: '2026-10-03T08:00:00.000Z', description: null, originalFilename: null })],
    });
    expect(await screen.findByText('Plik usunięty przez administratora 03.10.2026.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Powiększ:/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Usuń/ })).toBeNull();
  });
});

describe('EVM-051 AC1 AC2 AC6 documents', () => {
  it('EVM-051 AC1 the Administrator deletes a document from the menu and "Cofnij" restores it', async () => {
    const restore = vi.fn<Handler>(noContent);
    const api = await openDocuments({ documents: [DOCUMENT], routes: { [`POST ${DOCUMENT_URL}/restore`]: restore } });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Usuń' }));
    expect(await screen.findByText('Usunięto.')).toBeTruthy();
    expect(api.calls(`DELETE ${DOCUMENT_URL}`)).toHaveLength(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Cofnij' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
  });

  it('EVM-051 AC2 "Usuń plik trwale…" of a document asks W-04 and sends the version in If-Match', async () => {
    const purge = vi.fn<Handler>();
    purge.mockImplementationOnce(() => problem(403, 'step_up_required')).mockImplementation(noContent);
    const api = await openDocuments({ documents: [DOCUMENT], routes: { [`POST ${DOCUMENT_URL}/purge-file`]: purge } });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Usuń plik trwale…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Usunąć plik trwale?' });
    expect(within(dialog).getByText(/Wszystkie wersje pliku dokumentu/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń plik trwale' }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENT_URL}/purge-file`)).toHaveLength(2);
    });
    expect(api.calls(`POST ${DOCUMENT_URL}/purge-file`)[1]?.headers.get('If-Match')).toBe('"4"');
    expect(await screen.findByText('Plik usunięty trwale.')).toBeTruthy();
  });

  it('EVM-051 AC2 an erased document shows the marker, has no download, edit or purge; only "Usuń" stays', async () => {
    await openDocuments({
      documents: [
        doc(2, {
          title: 'Plik usunięty przez administratora 03.10.2026.',
          fileErasedAt: '2026-10-03T08:00:00.000Z',
          originalFilename: null,
        }),
      ],
    });
    expect(await screen.findAllByText('Plik usunięty przez administratora 03.10.2026.')).not.toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: /^Akcje dokumentu/ }));
    expect(await screen.findByRole('menuitem', { name: 'Usuń' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Usuń plik trwale…' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Pobierz' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Edytuj…' })).toBeNull();
  });

  it('EVM-051 AC6 the Editor has no "Usuń" and no "Usuń plik trwale…" in the menu', async () => {
    await openDocuments({ session: role('editor'), documents: [DOCUMENT] });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
    expect(await screen.findByRole('menuitem', { name: 'Edytuj…' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Usuń' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Usuń plik trwale…' })).toBeNull();
  });

  it('EVM-051 AC6 Tylko odczyt has no erased document actions', async () => {
    await openDocuments({
      session: role('read_only'),
      documents: [doc(3, { title: 'Plik usunięty przez administratora 03.10.2026.', fileErasedAt: '2026-10-03T08:00:00.000Z' })],
    });
    expect(await screen.findAllByText('Plik usunięty przez administratora 03.10.2026.')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Pobierz|Akcje dokumentu/ })).toBeNull();
  });
});
