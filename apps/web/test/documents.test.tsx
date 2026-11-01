import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem } from './api-fake.ts';
import { DOCUMENTS_BASE, doc, documentsApi, type DocumentsServerOptions } from './documents-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 "Dokumenty zlecenia" (EVM-047 AC1-AC8): the dialog "Dodaj dokument", the table with the class, "Podnieś klasę", the download by class.
const PATH = `/work-orders/${ORDER_ID}`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const role = (value: 'administrator' | 'editor' | 'read_only') => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: value } });

/** XMLHttpRequest of the browser replaced by a bucket that accepts every part; the requests are kept for assertions. */
class FakeBucket {
  static puts: { url: string; size: number; withCredentials: boolean }[] = [];
  withCredentials = true;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  send(body: Blob) {
    FakeBucket.puts.push({ url: this.url, size: body.size, withCredentials: this.withCredentials });
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size });
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);

beforeEach(() => {
  FakeBucket.puts = [];
  vi.stubGlobal('XMLHttpRequest', FakeBucket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openDocuments(options: DocumentsServerOptions = {}) {
  const api = documentsApi(options);
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ });
  return api;
}

const dialog = () => screen.getByRole('dialog');
const choose = (picked: File[]) => {
  fireEvent.change(within(dialog()).getByLabelText('Plik dokumentu'), { target: { files: picked } });
};
const table = () => screen.getByRole('table', { name: 'Dokumenty zlecenia' });

async function fillAndSend(options: {
  name?: string;
  kind: string;
  title: string;
  identity?: 'Nie' | 'Tak — klasa „Dane identyfikacyjne”';
}) {
  await userEvent.click(screen.getByRole('button', { name: 'Dodaj dokument' }));
  choose([file(options.name ?? 'warunki.pdf')]);
  await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), options.kind);
  if (options.identity !== undefined) await userEvent.click(within(dialog()).getByRole('radio', { name: options.identity }));
  await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), options.title);
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
}

describe('EVM-047 AC1 adding a document', () => {
  it('EVM-047 AC1 a PDF with a kind and a title is created, sent in parts to the bucket and listed with the kind, the title, version 1 and "Standardowy"', async () => {
    const api = await openDocuments();
    expect(await screen.findByText('Brak dokumentów.')).toBeTruthy();
    await fillAndSend({ kind: 'Warunki przyłączenia', title: 'Warunki — Stoen' });
    await waitFor(() => {
      expect(within(table()).getByText('Warunki — Stoen')).toBeTruthy();
    });
    const [create] = api.calls(`POST ${DOCUMENTS_BASE}`);
    const body = JSON.parse(create?.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      kindCode: 'connection_conditions',
      title: 'Warunki — Stoen',
      file: { fileName: 'warunki.pdf', contentType: 'application/pdf', declaredSize: 1000 },
    });
    expect(String(body.id)).toMatch(UUIDV7);
    expect(body).not.toHaveProperty('containsIdentityData');
    expect(body).not.toHaveProperty('confidentialityOverride');
    expect(create?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(create?.headers.get('X-CSRF-Token')).toBe(ACTIVE_SESSION.csrfToken);
    expect(FakeBucket.puts).toHaveLength(1);
    // SR-WEB-04: the PUT carries no cookies; nothing is kept in the storage of the browser
    expect(FakeBucket.puts[0]?.withCredentials).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    const row = within(table()).getByRole('row', { name: 'Warunki — Stoen' });
    expect(within(row).getByText('Warunki przyłączenia')).toBeTruthy();
    expect(within(row).getByText('1')).toBeTruthy();
    expect(within(row).getByText('Standardowy')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Dokumenty zlecenia (1)' })).toBeTruthy();
  });

  it('EVM-047 AC1 the dialog has no accessibility violations and asks for the file, the kind and the title', async () => {
    const api = await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    expect(await axeViolations(dialog())).toEqual([]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    expect(within(dialog()).getByText('Wybierz plik dokumentu.')).toBeTruthy();
    expect(within(dialog()).getByText('Wybierz rodzaj dokumentu.')).toBeTruthy();
    expect(within(dialog()).getByText('Wpisz tytuł dokumentu.')).toBeTruthy();
    expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(0);
  });
});

describe('EVM-047 AC2 the class from the kind', () => {
  it('EVM-047 AC2 "Pełnomocnictwo" and "Projekt instalacji" show their class in words and the icon lock; "Standardowy" has none', async () => {
    await openDocuments({
      documents: [
        doc(1, {
          title: 'Pełnomocnictwo OSD',
          kindCode: 'power_of_attorney',
          kindName: 'Pełnomocnictwo',
          confidentiality: 'identity_data',
        }),
        doc(2, {
          title: 'Projekt WLZ',
          kindCode: 'installation_design',
          kindName: 'Projekt instalacji',
          confidentiality: 'building_security',
        }),
        doc(3, { title: 'Warunki' }),
      ],
    });
    const poa = await within(table()).findByRole('row', { name: 'Pełnomocnictwo OSD' });
    expect(within(poa).getByText('Dane identyfikacyjne')).toBeTruthy();
    expect(poa.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const design = within(table()).getByRole('row', { name: 'Projekt WLZ' });
    expect(within(design).getByText('Bezpieczeństwo budynku')).toBeTruthy();
    const standard = within(table()).getByRole('row', { name: 'Warunki' });
    expect(within(standard).getByText('Standardowy')).toBeTruthy();
    expect(standard.querySelectorAll('td svg[aria-hidden="true"]').length).toBeLessThan(
      poa.querySelectorAll('td svg[aria-hidden="true"]').length,
    );
  });

  it('EVM-047 AC2 the dialog tells the class that the chosen kind gives', async () => {
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'Pełnomocnictwo');
    expect(within(dialog()).getByText('Klasa poufności: z rodzaju — Dane identyfikacyjne')).toBeTruthy();
    expect(within(dialog()).queryByRole('combobox', { name: 'Podnieś klasę' })).toBeNull();
  });
});

describe('EVM-047 AC3 "Inny dokument" and PESEL', () => {
  it('EVM-047 AC3 without an answer the dialog refuses; "Tak" sets the class "Dane identyfikacyjne" and sends containsIdentityData', async () => {
    const api = await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    choose([file('oswiadczenie.pdf')]);
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'Inny dokument');
    expect(within(dialog()).getByRole('group', { name: 'Czy dokument zawiera PESEL lub numer dokumentu tożsamości?' })).toBeTruthy();
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), 'Oświadczenie klienta');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    expect(within(dialog()).getByText('Odpowiedz, czy dokument zawiera PESEL lub numer dokumentu tożsamości.')).toBeTruthy();
    expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(0);
    await userEvent.click(within(dialog()).getByRole('radio', { name: 'Tak — klasa „Dane identyfikacyjne”' }));
    expect(within(dialog()).getByText('Klasa poufności: z rodzaju — Dane identyfikacyjne')).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({
      kindCode: 'other',
      containsIdentityData: true,
    });
    expect(await within(table()).findByText('Dane identyfikacyjne')).toBeTruthy();
  });

  it('EVM-047 AC3 "Nie" sends containsIdentityData false and the class stays "Standardowy"; another kind is not asked', async () => {
    const api = await openDocuments();
    await fillAndSend({ name: 'inne.pdf', kind: 'Inny dokument', title: 'Inne', identity: 'Nie' });
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({ containsIdentityData: false });
    expect(await within(table()).findByText('Standardowy')).toBeTruthy();
  });
});

describe('EVM-047 AC4 raising the class', () => {
  it('EVM-047 AC4 the dialog offers only the classes above the kind and sends the chosen one as confidentialityOverride', async () => {
    const api = await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    choose([file('projekt.pdf')]);
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'Projekt instalacji');
    const raise = within(dialog()).getByRole('combobox', { name: 'Podnieś klasę' });
    expect(
      within(raise)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Bez podniesienia', 'Dane identyfikacyjne']);
    await userEvent.selectOptions(raise, 'Dane identyfikacyjne');
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), 'Projekt WLZ');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({
      kindCode: 'installation_design',
      confidentialityOverride: 'identity_data',
    });
  });

  it('EVM-047 AC4 for a standard kind both higher classes are offered', async () => {
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'Warunki przyłączenia');
    const raise = within(dialog()).getByRole('combobox', { name: 'Podnieś klasę' });
    expect(
      within(raise)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Bez podniesienia', 'Bezpieczeństwo budynku', 'Dane identyfikacyjne']);
  });

  it.each(['administrator', 'editor'] as const)(
    'EVM-047 AC4 %s raises the class from the menu ⋮ with If-Match and sees the new class',
    async (who) => {
      const api = await openDocuments({ session: role(who), documents: [doc(1, { title: 'Warunki', version: 3 })] });
      await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Podnieś klasę…' }));
      const ask = await screen.findByRole('dialog', { name: 'Podnieś klasę dokumentu' });
      const target = within(ask).getByRole('combobox', { name: 'Nowa klasa' });
      expect(
        within(target)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Bezpieczeństwo budynku', 'Dane identyfikacyjne']);
      expect(await axeViolations(ask)).toEqual([]);
      await userEvent.selectOptions(target, 'Dane identyfikacyjne');
      await userEvent.click(within(ask).getByRole('button', { name: 'Podnieś klasę' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      const [patch] = api.calls(`PATCH ${DOCUMENTS_BASE}/${doc(1).id}`);
      expect(patch?.headers.get('If-Match')).toBe('"3"');
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({ confidentialityOverride: 'identity_data' });
    },
  );

  it('EVM-047 AC4 a class the server refuses (400) is told in the dialog and a changed document (412) asks for a fresh list', async () => {
    let answer = problem(400, 'validation_failed');
    await openDocuments({ documents: [doc(1, { title: 'Warunki' })], raise: () => answer });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Podnieś klasę…' }));
    const ask = await screen.findByRole('dialog', { name: 'Podnieś klasę dokumentu' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Podnieś klasę' }));
    expect(await within(ask).findByText('Wybierz klasę wyższą niż obecna.')).toBeTruthy();
    answer = problem(412, 'version_conflict');
    await userEvent.click(within(ask).getByRole('button', { name: 'Podnieś klasę' }));
    expect(await within(ask).findByText('Dokument zmienił się w międzyczasie. Odśwież listę i spróbuj ponownie.')).toBeTruthy();
  });

  it('EVM-047 AC4 a document of the highest class cannot be raised: the menu item says why', async () => {
    await openDocuments({ documents: [doc(1, { title: 'Pełnomocnictwo', confidentiality: 'identity_data' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Pełnomocnictwo' }));
    const item = screen.getByRole('menuitem', { name: /Podnieś klasę…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Dokument ma już najwyższą klasę.');
  });
});

describe('EVM-047 AC5 the download by class', () => {
  const spyAnchor = () => {
    const clicked: Array<{ href: string; rel: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, rel: this.rel });
    });
    return clicked;
  };
  const mixed = [
    doc(1, { title: 'Standardowy plik' }),
    doc(2, { title: 'Plik budynku', confidentiality: 'building_security', canDownload: false }),
    doc(3, { title: 'Plik tożsamości', confidentiality: 'identity_data', canDownload: false }),
  ];

  it('EVM-047 AC5 Tylko odczyt: a standard document has "Pobierz", the restricted ones say who can and have no button or menu', async () => {
    const clicked = spyAnchor();
    const api = await openDocuments({ session: role('read_only'), documents: mixed });
    expect(await screen.findByRole('heading', { level: 2, name: 'Dokumenty zlecenia (3)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj dokument' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Akcje dokumentu/ })).toBeNull();
    for (const title of ['Plik budynku', 'Plik tożsamości']) {
      const row = within(table()).getByRole('row', { name: title });
      expect(within(row).getByText('Plik dostępny dla administratora i edytora')).toBeTruthy();
      expect(within(row).queryByRole('button')).toBeNull();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Pobierz plik: Standardowy plik' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.href).toContain('/documents/');
    expect(clicked[0]?.rel).toContain('noreferrer');
    expect(api.calls(`POST ${DOCUMENTS_BASE}/${doc(1).id}/download-url`)).toHaveLength(1);
    expect(api.calls(`POST ${DOCUMENTS_BASE}/${doc(2).id}/download-url`)).toHaveLength(0);
    expect(await axeViolations(table())).toEqual([]);
  });

  it('EVM-047 AC5 the Editor downloads a document of a restricted class from the menu ⋮', async () => {
    const clicked = spyAnchor();
    await openDocuments({ session: role('editor'), documents: [doc(2, { title: 'Plik budynku', confidentiality: 'building_security' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Plik budynku' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pobierz plik' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
  });

  it('EVM-047 AC5 a file that is not `clean` yet cannot be downloaded: the menu item is disabled', async () => {
    await openDocuments({ documents: [doc(1, { title: 'Skanowany', fileState: 'scanning' })] });
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Skanowany' }));
    expect(screen.getByRole('menuitem', { name: /Pobierz plik/ }).getAttribute('aria-disabled')).toBe('true');
  });

  it.each([
    [429, 'rate_limited', 'Pobrano dużo plików w krótkim czasie. Spróbuj ponownie za 5 min.'],
    [403, 'forbidden', 'Nie masz uprawnień do pobrania tego pliku.'],
    [404, 'not_found', 'Nie znaleziono pliku. Mógł zostać usunięty.'],
    [500, 'internal_error', 'Nie udało się pobrać pliku. Spróbuj ponownie.'],
  ])('EVM-047 AC8 the answer %i to the download is told in words', async (status, code, text) => {
    spyAnchor();
    await openDocuments({
      session: role('read_only'),
      documents: [doc(1, { title: 'Standardowy plik' })],
      download: () => problem(status, code),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pobierz plik: Standardowy plik' }));
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('EVM-047 AC6 the types that are allowed', () => {
  it.each(['rysunek.svg', 'strona.html', 'paczka.zip', 'umowa.docm', 'arkusz.xlsm', 'bez-rozszerzenia'])(
    'EVM-047 AC6 %s is refused before anything is sent',
    async (name) => {
      const api = await openDocuments();
      await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
      choose([file(name)]);
      expect(within(dialog()).getByText(`Plik „${name}” ma nieobsługiwany format. Dodaj plik PDF, DOCX, XLSX, JPG lub PNG.`)).toBeTruthy();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
      expect(within(dialog()).getByText('Wybierz plik dokumentu.')).toBeTruthy();
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(0);
    },
  );

  it.each([
    ['a.pdf', 'application/pdf'],
    ['a.DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
  ])('EVM-047 AC6 %s is accepted and sent with the type %s', async (name, contentType) => {
    const api = await openDocuments();
    await fillAndSend({ name, kind: 'Warunki przyłączenia', title: 'Plik' });
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({ file: { contentType } });
  });

  it('EVM-047 AC6 a file over 100 MB and an empty file are refused with the reason', async () => {
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    choose([{ name: 'duzy.pdf', size: 100 * 1024 * 1024 + 1 } as unknown as File]);
    expect(within(dialog()).getByText('Plik „duzy.pdf” jest większy niż 100 MB.')).toBeTruthy();
    choose([file('pusty.pdf', 0)]);
    expect(within(dialog()).getByText('Plik „pusty.pdf” jest pusty.')).toBeTruthy();
  });

  it('EVM-047 AC6 a file that the scan held is shown as "Wymaga uwagi" without the reason', async () => {
    await openDocuments({ documents: [doc(1, { title: 'Z makrem', fileState: 'quarantined' })] });
    const row = await within(table()).findByRole('row', { name: 'Z makrem' });
    expect(within(row).getByText('Wymaga uwagi')).toBeTruthy();
    expect(within(row).getByText('Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.')).toBeTruthy();
  });

  it('EVM-047 AC6 the verdict of the scan for the file of the tab: "Sprawdzanie pliku" while the server checks', async () => {
    await openDocuments({ documents: [doc(1, { title: 'Skanowany', fileState: 'scanning' })] });
    const row = await within(table()).findByRole('row', { name: 'Skanowany' });
    expect(within(row).getByText('Sprawdzanie pliku')).toBeTruthy();
  });
});

describe('EVM-047 AC7 permissions', () => {
  it('EVM-047 AC7 Tylko odczyt has no "Dodaj dokument" and does not read the kinds of documents', async () => {
    const api = await openDocuments({ session: role('read_only'), documents: [doc(1)] });
    expect(screen.queryByRole('button', { name: 'Dodaj dokument' })).toBeNull();
    expect(api.calls('GET /api/v1/catalog/document-kinds')).toHaveLength(0);
  });

  it.each([
    [403, 'forbidden', 'Nie masz uprawnień do dodawania dokumentów.'],
    [400, 'validation_failed', 'Nie wysłano — serwer odrzucił dokument. Sprawdź rodzaj, tytuł i plik.'],
    [409, 'id_conflict', 'Nie wysłano — dokument o tym identyfikatorze już istnieje. Dodaj go ponownie.'],
    [429, 'rate_limited', 'Zbyt wiele zapytań. Spróbuj ponownie za chwilę.'],
    [500, 'internal_error', 'Nie udało się wysłać dokumentu. Spróbuj ponownie.'],
  ])(
    'EVM-047 AC7 the answer %i to the creation is told in the panel of the upload and the title stays text',
    async (status, code, text) => {
      await openDocuments({ create: () => problem(status, code) });
      await fillAndSend({ kind: 'Warunki przyłączenia', title: 'Warunki' });
      const panel = await screen.findByRole('list', { name: 'Wysyłanie dokumentu' });
      expect(await within(panel).findByText(text)).toBeTruthy();
      expect(within(panel).getByText('Warunki')).toBeTruthy();
    },
  );

  it('EVM-047 AC7 "Ponów" sends the same document again with the same key, "Ukryj" removes the failed line', async () => {
    let attempts = 0;
    const api = await openDocuments({
      create: (request) => {
        attempts += 1;
        return attempts === 1
          ? problem(500, 'internal_error')
          : json(201, doc(1, { id: (JSON.parse(request.body) as { id: string }).id, title: 'Warunki', fileState: 'pending_upload' }));
      },
    });
    await fillAndSend({ kind: 'Warunki przyłączenia', title: 'Warunki' });
    const panel = await screen.findByRole('list', { name: 'Wysyłanie dokumentu' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Ponów' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
    const [first, second] = api.calls(`POST ${DOCUMENTS_BASE}`);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect((JSON.parse(second?.body ?? '{}') as { id: string }).id).toBe((JSON.parse(first?.body ?? '{}') as { id: string }).id);
    await userEvent.click(await within(panel).findByRole('button', { name: 'Ukryj' }));
    expect(screen.queryByRole('list', { name: 'Wysyłanie dokumentu' })).toBeNull();
  });
});

describe('EVM-047 AC1 AC8 an upload session that ended on the server', () => {
  it('EVM-047 AC1 AC8 an expired session (409 invalid_state_transition) offers "Ponów", which opens a new session with a new key and finishes', async () => {
    let attempts = 0;
    const api = await openDocuments({
      complete: (request) => {
        attempts += 1;
        const id = request.path.split('/')[6] ?? '';
        return attempts === 1 ? problem(409, 'invalid_state_transition') : json(200, { ...doc(0, { id }), fileState: 'uploaded' });
      },
    });
    await fillAndSend({ kind: 'Warunki przyłączenia', title: 'Warunki' });
    const panel = await screen.findByRole('list', { name: 'Wysyłanie dokumentu' });
    expect(await within(panel).findByText('Nie udało się wysłać dokumentu. Spróbuj ponownie.')).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Ponów' }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });
    const [create] = api.calls(`POST ${DOCUMENTS_BASE}`);
    const documentId = (JSON.parse(create?.body ?? '{}') as { id: string }).id;
    const [first, second] = api.calls(`POST ${DOCUMENTS_BASE}/${documentId}/upload-sessions`);
    expect(second).toBeDefined();
    expect(second?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-047 AC8 a transient failure keeps the session key, so the retry gets the same session', async () => {
    let attempts = 0;
    const api = await openDocuments({
      complete: (request) => {
        attempts += 1;
        const id = request.path.split('/')[6] ?? '';
        return attempts === 1 ? problem(500, 'internal_error') : json(200, { ...doc(0, { id }), fileState: 'uploaded' });
      },
    });
    await fillAndSend({ kind: 'Warunki przyłączenia', title: 'Warunki' });
    const panel = await screen.findByRole('list', { name: 'Wysyłanie dokumentu' });
    await userEvent.click(await within(panel).findByRole('button', { name: 'Ponów' }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });
    const [create] = api.calls(`POST ${DOCUMENTS_BASE}`);
    const documentId = (JSON.parse(create?.body ?? '{}') as { id: string }).id;
    const [first, second] = api.calls(`POST ${DOCUMENTS_BASE}/${documentId}/upload-sessions`);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
  });
});

describe('EVM-047 AC8 states', () => {
  it('EVM-047 AC8 an empty list says "Brak dokumentów." with "Dodaj dokument" for the Editor and without it for Tylko odczyt', async () => {
    await openDocuments();
    expect(await screen.findByText('Brak dokumentów.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Dodaj dokument' }).length).toBeGreaterThan(0);
  });

  it('EVM-047 AC8 Tylko odczyt sees the empty state without the action', async () => {
    await openDocuments({ session: role('read_only') });
    expect(await screen.findByText('Brak dokumentów.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj dokument' })).toBeNull();
  });

  it('EVM-047 AC8 a list that failed to load is an alert in the section with "Spróbuj ponownie"; the other sections stay', async () => {
    let fail = true;
    await openDocuments({
      list: () =>
        fail ? problem(500, 'internal_error') : json(200, { items: [doc(1, { title: 'Wrócił' })], nextCursor: null, totalCount: 1 }),
    });
    expect(await screen.findByText('Nie wczytano dokumentów')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Media i dokumenty' })).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await within(table()).findByText('Wrócił')).toBeTruthy();
  });

  it('EVM-047 AC8 offline the button is disabled and a file being sent says that the sending waits for the connection', async () => {
    await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    choose([file('warunki.pdf')]);
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'Warunki przyłączenia');
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), 'Warunki');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        withCredentials = false;
        upload = { onprogress: null };
        onerror: (() => void) | null = null;
        open() {}
        send() {
          queueMicrotask(() => this.onerror?.());
        }
        abort() {}
      },
    );
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    expect((await screen.findAllByText('Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Dodaj dokument' })[0]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-047 AC8 title, description and file name are shown as text, never as markup (SR-WEB-03)', async () => {
    await openDocuments({
      documents: [
        doc(1, { title: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>', originalFilename: '<b>plik</b>.pdf' }),
      ],
    });
    const row = await within(table()).findByRole('row', { name: '<script>alert(1)</script>' });
    expect(within(row).getByText('<script>alert(1)</script>')).toBeTruthy();
    expect(within(row).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(within(row).getByText('<b>plik</b>.pdf')).toBeTruthy();
    expect(row.querySelector('script, img, b')).toBeNull();
  });

  it('EVM-047 AC8 the failed upload with a damaged file says so and a document with checksum_mismatch is not "Gotowy"', async () => {
    await openDocuments({
      documents: [
        doc(1, { title: 'Uszkodzony', fileState: 'failed', stateReasonCode: 'checksum_mismatch' }),
        doc(2, { title: 'Czeka', fileState: 'pending_upload' }),
      ],
    });
    const row = await within(table()).findByRole('row', { name: 'Uszkodzony' });
    expect(within(row).getByText('Nie wysłano — plik uszkodzony w czasie wysyłania')).toBeTruthy();
    expect(within(within(table()).getByRole('row', { name: 'Czeka' })).getByText('Czeka na plik')).toBeTruthy();
  });

  it('EVM-047 AC8 the list has no accessibility violations and a further page is loaded by "Pokaż więcej"', async () => {
    let page = 0;
    await openDocuments({
      list: () => {
        page += 1;
        return json(200, {
          items: [doc(page * 10, { title: `Strona ${String(page)}` })],
          nextCursor: page === 1 ? 'abc' : null,
          totalCount: 2,
        });
      },
    });
    expect(await within(table()).findByText('Strona 1')).toBeTruthy();
    expect(await axeViolations(screen.getByRole('region', { name: 'Dokumenty zlecenia' }))).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż więcej' }));
    expect(await within(table()).findByText('Strona 2')).toBeTruthy();
  });
});
