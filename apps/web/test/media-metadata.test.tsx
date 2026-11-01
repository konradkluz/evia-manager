import type { MediaAsset } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupByStage } from '../src/work-orders/media-gallery.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, type Handler } from './api-fake.ts';
import { DOCUMENTS_BASE, doc, documentsApi, type DocumentsServerOptions } from './documents-api.ts';
import { MEDIA_BASE, asset, mediaApi, type MediaServerOptions } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { STAGE_AGREEMENT, STAGE_CONDITIONS, STAGE_INSTALLATION } from './stages-api.ts';
import { userEvent } from './user.ts';
import { HEADER, ORDER_ID } from './work-order-api.ts';

// W-09 EVM-048: the stage at the upload, the edit of the metadata of a medium and of a document, the grouping by the stage.
const PATH = `/work-orders/${ORDER_ID}`;
const PROCEDURES = `GET /api/v1/work-orders/${ORDER_ID}/procedures`;
const READ_ONLY = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' as const } };
const ready = (n: number, extra: Partial<MediaAsset> = {}) => asset(n, { fileState: 'ready', ...extra });
const MARKER = '<script>window.__evm048 = 1</script> Rozdzielnica po montażu';
const EDIT_MEDIA = 'Edytuj opis, kategorię i etap';
const STAGE_LABEL = 'Etap (opcjonalnie)';
const DESCRIPTION_LABEL = 'Opis (opcjonalnie)';

class FakeBucket {
  withCredentials = true;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  open() {
    /* nothing to open */
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
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openTab(api: ReturnType<typeof mediaApi> | ReturnType<typeof documentsApi>) {
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
}

async function openMedia(options: MediaServerOptions = {}) {
  const api = mediaApi({ assets: [ready(1)], ...options });
  await openTab(api);
  return api;
}

async function openDocuments(options: DocumentsServerOptions = {}) {
  const api = documentsApi(options);
  await openTab(api);
  await screen.findByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ });
  return api;
}

async function openEditor() {
  await userEvent.click(await screen.findByRole('button', { name: /^Powiększ: Zdjęcie/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edytuj opis' }));
  return await screen.findByRole('dialog', { name: EDIT_MEDIA });
}
async function openDocumentEditor(title: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Akcje dokumentu: ${title}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj…' }));
  return await screen.findByRole('dialog', { name: 'Edytuj dokument' });
}
const optionNames = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);
const patchOf = (api: ReturnType<typeof mediaApi>) => api.calls(`PATCH ${MEDIA_BASE}/${asset(1).id}`);
const STAGE_GONE = () => problem(400, 'validation_failed', { errors: [{ pointer: '/procedureStageId', code: 'unknown_stage' }] });

function chooseImage(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('Wybrane pliki'), {
    target: { files: [new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })] },
  });
}

describe('EVM-048 AC1 the stage at the upload', () => {
  it('EVM-048 AC1 the photos dialog offers only the stages of this order and sends the chosen one with the media', async () => {
    const api = await openMedia({ assets: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    const dialog = screen.getByRole('dialog');
    chooseImage(dialog);
    const select = within(dialog).getByRole('combobox', { name: STAGE_LABEL });
    expect(optionNames(select)).toEqual(['Bez etapu', 'Uzgodnienie warunków', 'Umowa z OSD', 'Montaż i uruchomienie']);
    await userEvent.selectOptions(select, STAGE_AGREEMENT.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij 1 plik' }));
    await waitFor(() => {
      expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(1);
    });
    const [create] = api.calls(`POST ${MEDIA_BASE}`);
    expect(JSON.parse(create?.body ?? '{}')).toMatchObject({ items: [{ procedureStageId: STAGE_AGREEMENT.id }] });
  });

  it('EVM-048 AC1 without a choice the media are sent without a stage', async () => {
    const api = await openMedia({ assets: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    const dialog = screen.getByRole('dialog');
    chooseImage(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij 1 plik' }));
    await waitFor(() => {
      expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(1);
    });
    expect(api.calls(`POST ${MEDIA_BASE}`)[0]?.body).not.toContain('procedureStageId');
  });

  it('EVM-048 AC1 a stage that is gone at the media upload ends the row with a message, "Ponów" sends without the stage and the stages are read again', async () => {
    let calls = 0;
    const api = await openMedia({
      assets: [],
      create: (request) => {
        calls += 1;
        if (calls === 1) return STAGE_GONE();
        return json(201, { items: [] }, { 'X-Retry': request.path });
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    const dialog = screen.getByRole('dialog');
    chooseImage(dialog);
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_INSTALLATION.id);
    const before = api.calls(PROCEDURES).length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Wyślij 1 plik' }));
    expect(await screen.findByText(/wybrany etap nie jest już dostępny/)).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(PROCEDURES).length).toBeGreaterThan(before);
    });
    await userEvent.click(screen.getByRole('button', { name: /^Ponów/ }));
    await waitFor(() => {
      expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(2);
    });
    expect(api.calls(`POST ${MEDIA_BASE}`)[1]?.body).not.toContain('procedureStageId');
  });

  it('EVM-048 AC1 the document dialog offers the stages of this order and sends the chosen one', async () => {
    const api = await openDocuments();
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Plik dokumentu'), {
      target: { files: [new File([new Uint8Array(10)], 'warunki.pdf')] },
    });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'connection_conditions');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), 'Warunki');
    const select = within(dialog).getByRole('combobox', { name: STAGE_LABEL });
    expect(optionNames(select)).toEqual(['Bez etapu', 'Uzgodnienie warunków', 'Umowa z OSD', 'Montaż i uruchomienie']);
    await userEvent.selectOptions(select, STAGE_CONDITIONS.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(api.calls(`POST ${DOCUMENTS_BASE}`)).toHaveLength(1);
    });
    expect(JSON.parse(api.calls(`POST ${DOCUMENTS_BASE}`)[0]?.body ?? '{}')).toMatchObject({ procedureStageId: STAGE_CONDITIONS.id });
    const table = await screen.findByRole('table', { name: 'Dokumenty zlecenia' });
    expect(await within(table).findByText('Uzgodnienie warunków', { selector: 'td, [role="cell"], span, div, dd' })).toBeTruthy();
  });

  it('EVM-048 AC1 AC8 a stage that is gone at the document upload ends the row with a message without "Ponów" and the stages are read again', async () => {
    const api = await openDocuments({ create: STAGE_GONE });
    await userEvent.click(await screen.findByRole('button', { name: 'Dodaj dokument' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Plik dokumentu'), { target: { files: [new File([new Uint8Array(10)], 'a.pdf')] } });
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Rodzaj dokumentu' }), 'connection_conditions');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), 'Warunki');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_INSTALLATION.id);
    const before = api.calls(PROCEDURES).length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj dokument' }));
    expect(await screen.findByText(/wybrany etap nie jest już dostępny/)).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(PROCEDURES).length).toBeGreaterThan(before);
    });
    expect(screen.queryByRole('button', { name: 'Ponów' })).toBeNull();
  });
});

describe('EVM-048 AC2 the edit of a medium', () => {
  it('EVM-048 AC2 the lightbox saves the category, the description and the stage with If-Match; the description is text and the dialog reminds about PESEL', async () => {
    const api = await openMedia();
    const dialog = await openEditor();
    expect(within(dialog).getByText(/Nie wpisuj PESEL/)).toBeTruthy();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Kategoria' }), 'defect');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_AGREEMENT.id);
    fireEvent.change(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), { target: { value: MARKER } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: EDIT_MEDIA })).toBeNull();
    });
    const [patch] = patchOf(api);
    expect(patch?.headers.get('If-Match')).toBe('"1"');
    expect(patch?.headers.get('X-CSRF-Token')).toBe(ACTIVE_SESSION.csrfToken);
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({ category: 'defect', procedureStageId: STAGE_AGREEMENT.id, description: MARKER });
    // the description is shown as text: no element is made of it (SR-WEB-03)
    const viewer = await screen.findByRole('dialog', { name: /\(1 z / });
    expect(await within(viewer).findByText(`Opis: ${MARKER}`)).toBeTruthy();
    expect(within(viewer).getByText('Etap: Umowa z OSD')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('EVM-048 AC2 nothing is sent when nothing changed, and an emptied description is sent as null', async () => {
    const api = await openMedia({ assets: [ready(1, { description: 'Stary opis' })] });
    const dialog = await openEditor();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: EDIT_MEDIA })).toBeNull();
    });
    expect(patchOf(api)).toHaveLength(0);
    const again = await openEditor();
    await userEvent.clear(within(again).getByRole('textbox', { name: DESCRIPTION_LABEL }));
    await userEvent.click(within(again).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(patchOf(api)).toHaveLength(1);
    });
    expect(JSON.parse(patchOf(api)[0]?.body ?? '{}')).toEqual({ description: null });
  });

  it('EVM-048 AC2 on 412 the dialog stays open with what was typed and the data on the server stay', async () => {
    const update: Handler = () => problem(412, 'version_conflict');
    const api = await openMedia({ update });
    const dialog = await openEditor();
    await userEvent.type(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), 'Nowy opis');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/Zdjęcie zmieniło się w międzyczasie/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: DESCRIPTION_LABEL }).value).toBe('Nowy opis');
    expect(patchOf(api)).toHaveLength(1);
  });

  it('EVM-048 AC2 the edit dialog has no accessibility violations', async () => {
    await openMedia();
    expect(await axeViolations(await openEditor())).toEqual([]);
  });
});

describe('EVM-048 AC4 AC8 states of the edit of a medium', () => {
  it('EVM-048 AC8 a stage removed in the meantime gives a message, clears the choice and reads the stages again', async () => {
    const api = await openMedia({ update: STAGE_GONE });
    const dialog = await openEditor();
    const before = api.calls(PROCEDURES).length;
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_INSTALLATION.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/Wybrany etap nie jest już dostępny/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLSelectElement>('combobox', { name: STAGE_LABEL }).value).toBe('');
    await waitFor(() => {
      expect(api.calls(PROCEDURES).length).toBeGreaterThan(before);
    });
  });

  it('EVM-048 AC8 429 shows the wait, 403 the missing right, 404 the missing medium', async () => {
    let answer: Response = problem(429, 'rate_limited', {}, { 'Retry-After': '30' });
    await openMedia({ update: () => answer });
    const dialog = await openEditor();
    await userEvent.type(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    answer = problem(403, 'forbidden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Nie masz uprawnień do edycji zdjęć.')).toBeTruthy();
    answer = problem(404, 'not_found');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Nie znaleziono zdjęcia. Mogło zostać usunięte.')).toBeTruthy();
  });

  it('EVM-048 AC8 offline the edit is disabled', async () => {
    await openMedia();
    await userEvent.click(await screen.findByRole('button', { name: /^Powiększ: Zdjęcie/ }));
    const viewer = await screen.findByRole('dialog', { name: /\(1 z / });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => {
      expect(within(viewer).getByRole('button', { name: 'Edytuj opis' }).getAttribute('aria-disabled')).toBe('true');
    });
  });
});

describe('EVM-048 AC7 who edits', () => {
  it('EVM-048 AC7 Tylko odczyt sees the metadata without the actions of the edit', async () => {
    await openMedia({
      session: READ_ONLY,
      assets: [ready(1, { description: 'Opis zdjęcia', procedureStageId: STAGE_AGREEMENT.id, procedureStageName: STAGE_AGREEMENT.name })],
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Powiększ: Zdjęcie/ }));
    const viewer = await screen.findByRole('dialog', { name: /\(1 z / });
    expect(within(viewer).getByText('Opis: Opis zdjęcia')).toBeTruthy();
    expect(within(viewer).getByText('Etap: Umowa z OSD')).toBeTruthy();
    expect(within(viewer).queryByRole('button', { name: 'Edytuj opis' })).toBeNull();
  });

  it('EVM-048 AC7 Tylko odczyt has no menu of a document, but sees the stage column', async () => {
    await openDocuments({
      session: READ_ONLY,
      documents: [doc(1, { title: 'Warunki', procedureStageId: STAGE_CONDITIONS.id, procedureStageName: STAGE_CONDITIONS.name })],
    });
    const table = await screen.findByRole('table', { name: 'Dokumenty zlecenia' });
    expect(within(table).getByRole('columnheader', { name: 'Etap' })).toBeTruthy();
    expect(within(table).getByText('Uzgodnienie warunków')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Akcje dokumentu: Warunki' })).toBeNull();
  });
});

describe('EVM-048 AC6 a closed order', () => {
  it('EVM-048 AC6 the media of a settled order stay editable', async () => {
    const api = await openMedia({
      routes: { [`GET /api/v1/work-orders/${ORDER_ID}`]: () => json(200, { ...HEADER, status: 'settled' }, { ETag: '"3"' }) },
    });
    const dialog = await openEditor();
    await userEvent.type(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), 'Po rozliczeniu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(patchOf(api)).toHaveLength(1);
    });
  });
});

describe('EVM-048 AC3 the edit of a document', () => {
  it('EVM-048 AC3 the menu "Edytuj…" saves the title, the description and the stage with If-Match; the text is shown as text', async () => {
    const api = await openDocuments({ documents: [doc(1, { title: 'Warunki' })] });
    const dialog = await openDocumentEditor('Warunki');
    expect(within(dialog).getByText(/Nie wpisuj PESEL/)).toBeTruthy();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Tytuł' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), 'Warunki — Stoen');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_CONDITIONS.id);
    fireEvent.change(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), { target: { value: MARKER } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edytuj dokument' })).toBeNull();
    });
    const [patch] = api.calls(`PATCH ${DOCUMENTS_BASE}/${doc(1).id}`);
    expect(patch?.headers.get('If-Match')).toBe('"1"');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({
      title: 'Warunki — Stoen',
      description: MARKER,
      procedureStageId: STAGE_CONDITIONS.id,
    });
    const table = await screen.findByRole('table', { name: 'Dokumenty zlecenia' });
    expect(await within(table).findByText(MARKER)).toBeTruthy();
    expect(within(table).getByText('Uzgodnienie warunków')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('EVM-048 AC3 an empty title is refused before anything is sent; 412 keeps the dialog and the typed text', async () => {
    const api = await openDocuments({ documents: [doc(1, { title: 'Warunki' })], raise: () => problem(412, 'version_conflict') });
    const dialog = await openDocumentEditor('Warunki');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Tytuł' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(within(dialog).getByText('Wpisz tytuł dokumentu.')).toBeTruthy();
    expect(api.calls(`PATCH ${DOCUMENTS_BASE}/${doc(1).id}`)).toHaveLength(0);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), 'Nowy tytuł');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/Dokument zmienił się w międzyczasie/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Nowy tytuł');
  });

  it('EVM-048 AC3 after 412 the list is refreshed and the next save sends the new version in If-Match', async () => {
    let current = doc(1, { title: 'Warunki' });
    const api = await openDocuments({
      documents: [current],
      list: () => json(200, { items: [current], nextCursor: null, totalCount: 1 }),
      raise: (request) => {
        if (request.headers.get('If-Match') === '"1"') {
          current = { ...current, version: 2 };
          return problem(412, 'version_conflict');
        }
        return json(200, { ...current, ...(parseBody(request.body) as object), version: 3 }, { ETag: '"3"' });
      },
    });
    const dialog = await openDocumentEditor('Warunki');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), ' 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/Dokument zmienił się w międzyczasie/)).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(`GET ${DOCUMENTS_BASE}`).length).toBeGreaterThan(1);
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edytuj dokument' })).toBeNull();
    });
    const sent = api.calls(`PATCH ${DOCUMENTS_BASE}/${doc(1).id}`).map((call) => call.headers.get('If-Match'));
    expect(sent).toEqual(['"1"', '"2"']);
  });

  it('EVM-048 AC3 nothing is sent when nothing changed', async () => {
    const api = await openDocuments({ documents: [doc(1, { title: 'Warunki' })] });
    const dialog = await openDocumentEditor('Warunki');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edytuj dokument' })).toBeNull();
    });
    expect(api.calls(`PATCH ${DOCUMENTS_BASE}/${doc(1).id}`)).toHaveLength(0);
  });

  it('EVM-048 AC8 a stage that is gone gives a message and a fresh list; the dialog has no accessibility violations', async () => {
    const api = await openDocuments({ documents: [doc(1, { title: 'Warunki' })], raise: STAGE_GONE });
    const dialog = await openDocumentEditor('Warunki');
    expect(await axeViolations(dialog)).toEqual([]);
    const before = api.calls(PROCEDURES).length;
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: STAGE_LABEL }), STAGE_INSTALLATION.id);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText(/Wybrany etap nie jest już dostępny/)).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(PROCEDURES).length).toBeGreaterThan(before);
    });
  });

  it('EVM-048 AC8 429 and 403 are told in words; offline the item "Edytuj…" is disabled', async () => {
    let answer: Response = problem(429, 'rate_limited', {}, { 'Retry-After': '90' });
    await openDocuments({ documents: [doc(1, { title: 'Warunki' })], raise: () => answer });
    const dialog = await openDocumentEditor('Warunki');
    await userEvent.type(within(dialog).getByRole('textbox', { name: DESCRIPTION_LABEL }), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 2 min.')).toBeTruthy();
    answer = problem(403, 'forbidden');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Nie masz uprawnień do edycji dokumentu.')).toBeTruthy();
    answer = problem(404, 'not_found');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Nie znaleziono dokumentu. Mógł zostać usunięty.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje dokumentu: Warunki' }));
    expect(screen.getByRole('menuitem', { name: /^Edytuj…/ }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('EVM-048 AC5 grouping by the stage', () => {
  const inStage = (n: number, stage: { id: string; name: string } | null, extra: Partial<MediaAsset> = {}) =>
    ready(n, { procedureStageId: stage?.id ?? null, procedureStageName: stage?.name ?? null, ...extra });

  it('EVM-048 AC5 groupByStage puts the stages in the order of the processes, a removed stage after them and "Bez etapu" last', () => {
    const gone = { id: '01968f3e-0000-7000-8000-0000000f1999', name: 'Etap usunięty' };
    const groups = groupByStage(
      [inStage(1, null), inStage(2, STAGE_INSTALLATION), inStage(3, gone), inStage(4, STAGE_CONDITIONS), inStage(5, STAGE_CONDITIONS)],
      [STAGE_CONDITIONS.id, STAGE_AGREEMENT.id, STAGE_INSTALLATION.id],
    );
    expect(groups.map((group) => [group.label, group.assets.length])).toEqual([
      ['Uzgodnienie warunków', 2],
      ['Montaż i uruchomienie', 1],
      ['Etap usunięty', 1],
      ['Bez etapu', 1],
    ]);
    expect(groupByStage([], [])).toEqual([]);
  });

  it('EVM-048 AC5 "Grupuj: Etap" regroups the gallery with the group "Bez etapu"; "Kategoria" brings the categories back', async () => {
    await openMedia({ assets: [inStage(1, STAGE_AGREEMENT), inStage(2, null), inStage(3, STAGE_AGREEMENT)] });
    expect(await screen.findByRole('heading', { level: 4, name: 'W trakcie prac (3)' })).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Etap' }));
    expect(await screen.findByRole('heading', { level: 4, name: 'Umowa z OSD (2)' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Bez etapu (1)' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 4, name: 'W trakcie prac (3)' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Kategoria' }));
    expect(await screen.findByRole('heading', { level: 4, name: 'W trakcie prac (3)' })).toBeTruthy();
  });

  it('EVM-048 AC5 the table of documents has the column "Etap" with "Bez etapu" for a document without a stage', async () => {
    await openDocuments({
      documents: [
        doc(1, { title: 'Warunki', procedureStageId: STAGE_CONDITIONS.id, procedureStageName: STAGE_CONDITIONS.name }),
        doc(2, { title: 'Pełnomocnictwo' }),
      ],
    });
    const table = await screen.findByRole('table', { name: 'Dokumenty zlecenia' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getByText('Uzgodnienie warunków')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Bez etapu')).toBeTruthy();
  });
});
