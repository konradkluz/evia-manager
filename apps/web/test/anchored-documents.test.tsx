import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem } from './api-fake.ts';
import { CUSTOMER_ID, DOCUMENTS_BASE, KINDS, SITE_ID, doc, documentsApi, type DocumentsServerOptions } from './documents-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 "Dokumenty lokalizacji (n)" / "Dokumenty klienta (n)" and "Przypisz do" (EVM-050 AC1, AC2, AC5, AC7).
const PATH = `/work-orders/${ORDER_ID}`;
const SITE_LIST = `GET /api/v1/sites/${SITE_ID}/documents`;
const CUSTOMER_LIST = `GET /api/v1/customers/${CUSTOMER_ID}/documents`;
const role = (value: 'administrator' | 'editor' | 'read_only') => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: value } });
const page = (items: unknown[]) => () => json(200, { items, nextCursor: null, totalCount: items.length });
const BUILDING = { code: 'building_documentation', name: 'Dokumentacja budynku', confidentiality: 'building_security' as const };

class FakeBucket {
  withCredentials = true;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  open() {
    /* the address is not needed */
  }
  send(body: Blob) {
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size });
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeBucket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(options: DocumentsServerOptions = {}) {
  const api = documentsApi({ kinds: [...KINDS, BUILDING], ...options });
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ });
  return api;
}

const dialog = () => screen.getByRole('dialog');
async function startDialog(kind: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
  fireEvent.change(within(dialog()).getByLabelText('Plik dokumentu'), {
    target: { files: [new File([new Uint8Array(1000)], 'budynek.pdf')] },
  });
  await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), kind);
  await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), 'Dokumentacja od administracji');
}

describe('EVM-050 AC1 "Przypisz do"', () => {
  it('EVM-050 AC1 the dialog defaults to "Zlecenia"; "Lokalizacji" warns who will see the document, hides the stage and sends anchor site', async () => {
    const api = await open({ routes: { [SITE_LIST]: page([]) } });
    await startDialog('Dokumentacja budynku');
    const radios = within(dialog()).getByRole('group', { name: 'Przypisz do' });
    expect(within(radios).getByRole<HTMLInputElement>('radio', { name: 'Zlecenia' }).checked).toBe(true);
    expect(within(dialog()).getByRole('combobox', { name: 'Etap (opcjonalnie)' })).toBeTruthy();
    await userEvent.click(within(radios).getByRole('radio', { name: 'Lokalizacji' }));
    expect(within(dialog()).getByText(/zobaczą zlecenia wszystkich klientów w tej lokalizacji/)).toBeTruthy();
    expect(within(dialog()).queryByRole('combobox', { name: 'Etap (opcjonalnie)' })).toBeNull();
    expect(await axeViolations(dialog())).toEqual([]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    const body = JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ anchor: 'site', kindCode: 'building_documentation' });
    expect(body).not.toHaveProperty('procedureStageId');
    expect(body).not.toHaveProperty('siteId');
    expect(body).not.toHaveProperty('customerId');
  });

  it('EVM-050 AC1 "Klienta" sends anchor customer', async () => {
    const api = await open({ routes: { [CUSTOMER_LIST]: page([]) } });
    await startDialog('Dokumentacja budynku');
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Klienta' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({ anchor: 'customer' });
  });

  it('EVM-050 AC1 "Zlecenia" sends no anchor', async () => {
    const api = await open();
    await startDialog('Dokumentacja budynku');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).not.toHaveProperty('anchor');
  });

  it('EVM-050 AC1 a class "Dane identyfikacyjne" cannot go to a location: the dialog refuses it before anything is sent (AB-19)', async () => {
    const api = await open();
    await startDialog('Pełnomocnictwo');
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Lokalizacji' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    expect(within(dialog()).getByText(/nie można przypisać do lokalizacji/)).toBeTruthy();
    expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(0);
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Klienta' }));
    expect(within(dialog()).queryByText(/nie można przypisać do lokalizacji/)).toBeNull();
  });
});

describe('EVM-050 AC2 AC7 the sections of the location and of the customer', () => {
  it('EVM-050 AC2 the documents of the location and of the customer are listed in the order with the class in words', async () => {
    await open({
      routes: {
        [SITE_LIST]: page([
          doc(21, {
            anchor: 'site',
            workOrderId: null,
            siteId: SITE_ID,
            title: 'Dokumentacja od administracji',
            confidentiality: 'building_security',
          }),
        ]),
        [CUSTOMER_LIST]: page([doc(22, { anchor: 'customer', workOrderId: null, customerId: CUSTOMER_ID, title: 'Umowa ramowa' })]),
      },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty lokalizacji (1)' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty klienta (1)' })).toBeTruthy();
    const site = within(await screen.findByRole('table', { name: 'Dokumenty lokalizacji' }));
    expect(site.getByText('Dokumentacja od administracji')).toBeTruthy();
    expect(site.getByText('Bezpieczeństwo budynku')).toBeTruthy();
    expect(within(await screen.findByRole('table', { name: 'Dokumenty klienta' })).getByText('Umowa ramowa')).toBeTruthy();
  });

  it('EVM-050 AC7 no documents: both headings say (0) and there is no list', async () => {
    await open({ routes: { [SITE_LIST]: page([]), [CUSTOMER_LIST]: page([]) } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty lokalizacji (0)' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty klienta (0)' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Dokumenty lokalizacji' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Dokumenty klienta' })).toBeNull();
  });

  it('EVM-050 AC7 a location that is gone (404) shows no documents and no error', async () => {
    await open({ routes: { [SITE_LIST]: () => problem(404, 'not_found'), [CUSTOMER_LIST]: page([]) } });
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty lokalizacji (0)' })).toBeTruthy();
    expect(screen.getByText('Brak dokumentów lokalizacji.')).toBeTruthy();
    expect(screen.queryByText('Nie wczytano dokumentów')).toBeNull();
  });

  it('EVM-050 AC7 a list that failed is an error of its section with "Spróbuj ponownie"', async () => {
    let fail = true;
    await open({
      routes: {
        [SITE_LIST]: () => (fail ? problem(500, 'internal_error') : json(200, { items: [], nextCursor: null, totalCount: 0 })),
        [CUSTOMER_LIST]: page([]),
      },
    });
    expect(await screen.findByText('Nie wczytano dokumentów')).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty lokalizacji (0)' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText('Nie wczytano dokumentów')).toBeNull();
    });
  });
});

describe('EVM-050 AC5 the download of a document of the location', () => {
  const standard = doc(31, { anchor: 'site', workOrderId: null, siteId: SITE_ID, title: 'Plan garażu' });
  const secret = doc(32, {
    anchor: 'site',
    workOrderId: null,
    siteId: SITE_ID,
    title: 'Schemat zabezpieczeń',
    confidentiality: 'building_security',
    canDownload: false,
  });
  const downloadRoute = `POST /api/v1/sites/${SITE_ID}/documents/${standard.id}/download-url`;

  it('EVM-050 AC5 Tylko odczyt: "Pobierz" for the standard document through the path of the location; the other says who can', async () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.href);
    });
    const api = await open({
      session: role('read_only'),
      routes: {
        [SITE_LIST]: page([standard, secret]),
        [CUSTOMER_LIST]: page([]),
        [downloadRoute]: () =>
          json(200, {
            url: 'https://bucket.example.test/documents/file/original?X-Amz-Signature=sig',
            expiresAt: '2026-10-11T12:05:00.000Z',
          }),
      },
    });
    const table = within(await screen.findByRole('table', { name: 'Dokumenty lokalizacji' }));
    expect(screen.queryByRole('button', { name: 'Dodaj dokument' })).toBeNull();
    const row = table.getByRole('row', { name: 'Schemat zabezpieczeń' });
    expect(within(row).getByText('Plik dostępny dla administratora i edytora')).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
    await userEvent.click(table.getByRole('button', { name: 'Pobierz plik: Plan garażu' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(api.calls(downloadRoute)).toHaveLength(1);
  });

  it('EVM-050 AC5 a refused download (403) is told without the title', async () => {
    await open({
      routes: { [SITE_LIST]: page([standard]), [CUSTOMER_LIST]: page([]), [downloadRoute]: () => problem(403, 'forbidden') },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pobierz plik: Plan garażu' }));
    expect(await screen.findByText('Nie masz uprawnień do pobrania tego pliku.')).toBeTruthy();
  });
});
