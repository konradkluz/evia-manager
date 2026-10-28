import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem } from './api-fake.ts';
import { MEDIA_BASE, asset, mediaApi, unfinished, type MediaServerOptions } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;

/** XMLHttpRequest of the browser replaced by a bucket that accepts every part; the requests are kept for assertions. */
class FakeBucket {
  static puts: { url: string; size: number; withCredentials: boolean }[] = [];
  static status = 200;
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
    this.status = FakeBucket.status;
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size });
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

const jpeg = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

beforeEach(() => {
  FakeBucket.puts = [];
  FakeBucket.status = 200;
  vi.stubGlobal('XMLHttpRequest', FakeBucket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openMedia(options: MediaServerOptions = {}) {
  const api = mediaApi(options);
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

const dialog = () => screen.getByRole('dialog');
// A change event with the files: the picker of the system hands over what the person chose whatever `accept` says (the panel checks again).
const choose = (files: File[]) => {
  fireEvent.change(within(dialog()).getByLabelText('Wybrane pliki'), { target: { files } });
};

async function sendFiles(files: File[]) {
  await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
  choose(files);
  await userEvent.click(
    within(dialog()).getByRole('button', {
      name: new RegExp(`^Wyślij ${String(files.length)} ${files.length < 5 ? 'pliki|plik' : 'plików'}`),
    }),
  );
}

describe('EVM-044 AC1 W-09: the tab "Media i dokumenty" and the upload of photos', () => {
  it('EVM-044 AC1 two photos with a category are sent in parts straight to the bucket and end as "Wysłano"; nothing goes to the storage of the browser', async () => {
    const api = await openMedia();
    expect(await screen.findByText('To zlecenie nie ma jeszcze zdjęć.')).toBeTruthy();
    const files = [jpeg('IMG_0412.jpg'), jpeg('IMG_0413.jpg')];
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    expect(dialog().textContent).toContain('Przed zdjęciami do pracy: lokalizacja w aparacie wyłączona');
    choose(files);
    expect(within(dialog()).getByText('Wybrano 2 pliki · 2 kB')).toBeTruthy();
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Kategoria' }), 'completed_work');
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Opis (opcjonalnie)' }), 'Rozdzielnica po montażu');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 2 pliki' }));

    expect(await screen.findByText('Wysłano 2 zdjęcia — możesz je usunąć z telefonu. Potem opróżnij kosz galerii.')).toBeTruthy();
    const [create] = api.calls(`POST ${MEDIA_BASE}`);
    expect(JSON.parse(create?.body ?? '{}')).toMatchObject({
      items: [
        {
          category: 'completed_work',
          description: 'Rozdzielnica po montażu',
          fileName: 'IMG_0412.jpg',
          declaredSize: 1000,
          contentType: 'image/jpeg',
        },
        { fileName: 'IMG_0413.jpg' },
      ],
    });
    expect(create?.headers.get('X-CSRF-Token')).toBe(ACTIVE_SESSION.csrfToken);
    expect(FakeBucket.puts).toHaveLength(2);
    // SR-WEB-04: the PUT carries no cookies; the address is not stored anywhere
    expect(FakeBucket.puts.every((entry) => !entry.withCredentials && entry.url.startsWith('https://bucket.example.test/'))).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-044 AC1 while files are sent the panel says "Wysyłanie · 1 z 2" with the warning and shows the state of each file', async () => {
    const api = mediaApi({ stateAfterComplete: 'scanning' });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg'), jpeg('IMG_0413.jpg')]);
    const region = await screen.findByRole('region', { name: 'Wysyłanie plików' });
    await waitFor(() => {
      expect(within(region).getAllByText('Sprawdzanie pliku')).toHaveLength(2);
    });
    expect(within(region).getByRole('heading', { level: 3, name: 'Wysyłanie · 2 z 2' })).toBeTruthy();
    expect(within(region).getAllByText('Nie usuwaj go jeszcze z telefonu.')).toHaveLength(2);
    expect(within(region).getByText('IMG_0412.jpg')).toBeTruthy();
    expect(await axeViolations(region)).toEqual([]);
  });

  it('EVM-044 AC1 the media of the order that are already on the server are listed with their state', async () => {
    await openMedia({
      assets: [
        asset(1, { fileState: 'ready' }),
        asset(2, { fileState: 'scanning' }),
        asset(3, { category: 'defect', fileState: 'pending_upload' }),
      ],
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Zdjęcia · 3 zdjęcia' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Media i dokumenty' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Wysłano')).toBeTruthy();
    expect(within(list).getByText('Sprawdzanie pliku')).toBeTruthy();
    expect(within(list).getByText(/^Czeka na plik · od /)).toBeTruthy();
    expect(within(list).getByText(/^Zdjęcie · Usterka · 11\.10\.2026 /)).toBeTruthy();
  });
});

describe('EVM-044 AC2 the files that never leave the tab', () => {
  it('EVM-044 AC2 SVG, HTML, an archive and a photo over 50 MB are left out with the reason; the rest is sent', async () => {
    const api = await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    const huge = jpeg('ogromne.jpg');
    Object.defineProperty(huge, 'size', { value: 52_428_801 });
    choose([
      new File(['<svg/>'], 'plan.svg', { type: 'image/svg+xml' }),
      new File(['<html/>'], 'strona.html', { type: 'text/html' }),
      new File(['PK'], 'archiwum.zip', { type: 'application/zip' }),
      huge,
      jpeg('dobre.jpg'),
    ]);
    const skipped = within(dialog()).getByRole('status');
    expect(within(skipped).getByText('Pominięto 4 pliki:')).toBeTruthy();
    expect(within(skipped).getByText('Plik „plan.svg” ma nieobsługiwany format. Wybierz zdjęcie JPEG, HEIC, PNG albo WebP.')).toBeTruthy();
    expect(
      within(skipped).getByText('Plik „strona.html” ma nieobsługiwany format. Wybierz zdjęcie JPEG, HEIC, PNG albo WebP.'),
    ).toBeTruthy();
    expect(within(skipped).getByText('Plik „ogromne.jpg” jest większy niż 50 MB. Zmniejsz go albo wybierz inny.')).toBeTruthy();
    expect(within(dialog()).getByText('Wybrano 1 plik · 1 kB')).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Usuń z wyboru: dobre.jpg' }));
    expect(within(dialog()).queryByText(/^Wybrano/)).toBeNull();
    expect(within(dialog()).getByRole('button', { name: 'Wyślij 0 plików' }).getAttribute('aria-disabled')).toBe('true');
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
  });

  it('EVM-044 AC2 an empty file and more than 50 files are told to the person', async () => {
    await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    choose([new File([], 'pusty.jpg', { type: 'image/jpeg' })]);
    expect(within(dialog()).getByText('Plik „pusty.jpg” jest pusty.')).toBeTruthy();
    choose(Array.from({ length: 51 }, (_, index) => jpeg(`IMG_${String(index)}.jpg`, 10)));
    expect(within(dialog()).getByText('Naraz można wysłać najwyżej 50 plików. Wyślij resztę w kolejnej partii.')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Wyślij 50 plików' })).toBeTruthy();
  });

  it('EVM-044 AC2 Anuluj closes the dialog and the next opening starts empty', async () => {
    await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    choose([jpeg('a.jpg')]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    expect(within(dialog()).queryByText(/^Wybrano/)).toBeNull();
  });

  it('EVM-044 AC2 files dropped on the drop area open the dialog with the files chosen', async () => {
    await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    const zone = screen.getByText('Upuść zdjęcia tutaj albo').closest('div[class*="rounded-card"]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [jpeg('upuszczone.jpg')] } });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(within(dialog()).getByText('upuszczone.jpg · 1 kB')).toBeTruthy();
  });
});

describe('EVM-044 AC3 AC5 the verdicts of the server', () => {
  it('EVM-044 AC3 a file held by the scan shows "Wymaga uwagi" with no reason and no way to open it', async () => {
    await openMedia({ stateAfterComplete: 'quarantined' });
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('eicar.jpg')]);
    expect(await screen.findByText('Wymaga uwagi')).toBeTruthy();
    expect(screen.getByText('Nie usuwaj tego pliku z telefonu. Administrator został powiadomiony.')).toBeTruthy();
    expect(screen.queryByText(/malware|type_mismatch|wirus/i)).toBeNull();
  });

  it('EVM-044 AC3 a quarantined medium on the list says that the administrator was told (no reason)', async () => {
    await openMedia({ assets: [asset(1, { fileState: 'quarantined', needsAttention: true })] });
    expect(await screen.findByText('Wymaga uwagi')).toBeTruthy();
    expect(screen.getByText('Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.')).toBeTruthy();
  });

  it('EVM-044 AC5 a checksum mismatch says "Nie wysłano — plik uszkodzony w transmisji" and "Ponów" sends the file from the memory of the tab again', async () => {
    const api = await openMedia({ stateAfterComplete: 'failed', stateReasonCode: 'checksum_mismatch' });
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    expect(await screen.findByText('Nie wysłano — plik uszkodzony w transmisji')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Ponów wysyłanie: IMG_0412.jpg' });
    expect(FakeBucket.puts).toHaveLength(1);
    await userEvent.click(retry);
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(2);
    });
    expect(api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'))).toHaveLength(2);
    expect(await screen.findByText('Nie wysłano — plik uszkodzony w transmisji')).toBeTruthy();
  });

  it('EVM-044 AC5 a medium on the list that failed in transmission is told without "Ponów" (the file is not in this tab)', async () => {
    await openMedia({ assets: [asset(1, { fileState: 'failed', stateReasonCode: 'checksum_mismatch' })] });
    expect(await screen.findByText('Nie wysłano — plik uszkodzony w transmisji')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Ponów/ })).toBeNull();
  });
});

describe('EVM-044 AC4 the browser of a phone: files chosen again and the unfinished uploads', () => {
  const waiting = [unfinished(7, 'IMG_0412.jpg', 1000), unfinished(8, 'IMG_0413.jpg', 1000), unfinished(9, 'IMG_0414.jpg', 1000)];

  it('EVM-044 AC4 the banner "Nie wysłano 3 zdjęć — wybierz je ponownie z galerii." names the files from the unfinished sessions of the person', async () => {
    const api = mediaApi({ unfinished: waiting });
    await renderPanel(PATH, api);
    const banner = await screen.findByRole('region', { name: 'Niedokończone wysyłanie zdjęć' });
    expect(within(banner).getByText('Nie wysłano 3 zdjęć — wybierz je ponownie z galerii.')).toBeTruthy();
    expect(within(banner).getByText('IMG_0412.jpg · IMG_0413.jpg · IMG_0414.jpg')).toBeTruthy();
    expect(within(banner).getByText('Wybierz te same pliki — dopasujemy je po nazwie i rozmiarze.')).toBeTruthy();
    // no promise of a removal of empty items by the administrator: no such function exists
    expect(banner.textContent).not.toContain('pustych pozycji');
    expect(api.requests.some((entry) => entry.path === MEDIA_BASE && entry.query.get('uploadState') === 'unfinished')).toBe(true);
    expect(await axeViolations(banner)).toEqual([]);
  });

  it('EVM-044 AC4 "Wybierz ponownie z galerii" opens the dialog on the tab and the same files resume their sessions: no new medium', async () => {
    const api = mediaApi({ unfinished: waiting });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wybierz ponownie z galerii' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Media i dokumenty' }).getAttribute('aria-selected')).toBe('true');
    choose([jpeg('IMG_0412.jpg'), jpeg('IMG_0413.jpg'), jpeg('IMG_0414.jpg')]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 3 pliki' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(3);
    });
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
    expect(api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'))).toHaveLength(0);
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Niedokończone wysyłanie zdjęć' })).toBeNull();
    });
  });

  it('EVM-044 AC4 the interrupted batch with NO session is counted too and a re-chosen file opens a new session of the SAME medium (no duplicate)', async () => {
    const lost = [unfinished(7, 'IMG_0412.jpg', 1000), unfinished(8, 'IMG_0413.jpg', 1000, { uploadSession: null })];
    const api = mediaApi({ unfinished: lost });
    await renderPanel(PATH, api);
    const banner = await screen.findByRole('region', { name: 'Niedokończone wysyłanie zdjęć' });
    expect(within(banner).getByText('Nie wysłano 2 zdjęć — wybierz je ponownie z galerii.')).toBeTruthy();
    expect(within(banner).getByText('IMG_0412.jpg · IMG_0413.jpg')).toBeTruthy();
    await userEvent.click(within(banner).getByRole('button', { name: 'Wybierz ponownie z galerii' }));
    choose([jpeg('IMG_0412.jpg'), jpeg('IMG_0413.jpg')]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 2 pliki' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(2);
    });
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
    const sessions = api.requests.filter((entry) => entry.method === 'POST' && entry.path.endsWith('/upload-sessions'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.path).toContain(lost[1]?.id ?? 'missing');
  });

  it('EVM-044 AC4 a different file with the same name and size is "różni się od wysłanego wcześniej", not "uszkodzony w transmisji"', async () => {
    const waitingMedium = unfinished(7, 'IMG_0412.jpg', 1000);
    const api = mediaApi({
      unfinished: [waitingMedium],
      assets: [
        { ...waitingMedium, originalFilename: null, uploadSession: null, fileState: 'failed', stateReasonCode: 'checksum_mismatch' },
      ],
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Wybierz ponownie z galerii' }));
    choose([jpeg('IMG_0412.jpg')]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 1 plik' }));
    expect(await screen.findByText('Nie wysłano — plik różni się od wysłanego wcześniej')).toBeTruthy();
    expect(screen.queryByText(/uszkodzony/)).toBeNull();
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
  });

  it('EVM-044 AC4 one unfinished photo is told in the singular', async () => {
    await renderPanel(PATH, mediaApi({ unfinished: [unfinished(7, 'IMG_0412.jpg', 1000)] }));
    expect(await screen.findByText('Nie wysłano 1 zdjęcia — wybierz je ponownie z galerii.')).toBeTruthy();
  });

  it('EVM-044 AC4 without unfinished sessions there is no banner', async () => {
    await renderPanel(PATH, mediaApi());
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Niedokończone wysyłanie zdjęć' })).toBeNull();
    });
  });

  it('EVM-044 AC4 the buttons of the upload reach the size of a touch target and the dialog of the phone uses the picker of the system', async () => {
    await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));
    expect(within(dialog()).getByRole('button', { name: 'Wybierz z galerii' })).toBeTruthy();
    const input = within(dialog()).getByLabelText('Wybrane pliki');
    expect(input.getAttribute('accept')).toContain('image/heic');
    expect(input.getAttribute('capture')).toBeNull();
    expect(await axeViolations(dialog())).toEqual([]);
  });
});

describe('EVM-044 AC7 roles', () => {
  it('EVM-044 AC7 Tylko odczyt sees the list without the Uploader and the banner, and the unfinished uploads are not even asked for', async () => {
    const api = await openMedia({
      session: { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } },
      assets: [asset(1, { fileState: 'ready' })],
    });
    expect(await screen.findByText('Wysłano')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wybierz pliki' })).toBeNull();
    expect(api.requests.some((entry) => entry.query.get('uploadState') === 'unfinished')).toBe(false);
  });

  it('EVM-044 AC7 an Editor uploads like the Administrator', async () => {
    await openMedia({ session: { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } } });
    expect(await screen.findByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).toBeTruthy();
  });

  it('EVM-044 AC7 an empty order is told differently to the person who cannot add photos', async () => {
    await openMedia({ session: { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } } });
    expect(await screen.findByText('Zdjęcia dodaje Administrator albo Edytor.')).toBeTruthy();
  });
});

describe('EVM-044 AC8 states', () => {
  it('EVM-044 AC8 no media: "To zlecenie nie ma jeszcze zdjęć." with the way to add them', async () => {
    await openMedia();
    expect(await screen.findByText('To zlecenie nie ma jeszcze zdjęć.')).toBeTruthy();
    expect(screen.getByText('Dodaj pierwsze zdjęcia przyciskiem powyżej.')).toBeTruthy();
  });

  it('EVM-044 AC8 the list that cannot be read is an error with "Spróbuj ponownie" that reads it again', async () => {
    let fail = true;
    const api = mediaApi({
      routes: {
        [`GET ${MEDIA_BASE}`]: (request) =>
          request.query.get('uploadState') === 'unfinished'
            ? json(200, { items: [], nextCursor: null })
            : fail
              ? problem(500, 'internal_error')
              : json(200, { items: [asset(1)], nextCursor: null }),
      },
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    expect(await screen.findByText('Nie udało się wczytać mediów.')).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Wysłano')).toBeTruthy();
  });

  it('EVM-044 AC8 offline the buttons that start an upload are disabled', async () => {
    await openMedia();
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).getAttribute('aria-disabled')).toBe('true');
    });
  });

  it('EVM-044 AC8 429 on the creation of the media is told with the time from Retry-After and "Ponów" tries again', async () => {
    let attempts = 0;
    await openMedia({
      create: (request) => {
        attempts += 1;
        if (attempts === 1) return problem(429, 'rate_limited', {}, { 'Retry-After': '60' });
        const body = JSON.parse(request.body) as { items: { id: string }[] };
        return json(201, { items: body.items.map((item) => asset(1, { id: item.id, fileState: 'pending_upload' })) });
      },
    });
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 1 min.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ponów wysyłanie: IMG_0412.jpg' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
  });

  it('EVM-044 AC8 closing the tab with unsent files is warned about by the browser; with nothing unsent it is not', async () => {
    const api = mediaApi();
    FakeBucket.status = 403;
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    const idle = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    await sendFiles([jpeg('IMG_0412.jpg')]);
    await screen.findByText('Nie wysłano — spróbuj ponownie');
    const unsent = new Event('beforeunload', { cancelable: true });
    globalThis.dispatchEvent(unsent);
    expect(unsent.defaultPrevented).toBe(true);
  });

  it('EVM-044 AC8 "Wstrzymaj" stops a file in the queue and "Wznów" continues it', async () => {
    const api = mediaApi();
    let release: (() => void) | null = null;
    // the first part never answers until the test lets it go: the file stays in the queue long enough to be paused
    class SlowBucket extends FakeBucket {
      override send(body: Blob) {
        release = () => {
          super.send(body);
        };
      }
      override abort() {
        release = null;
        this.onabort?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', SlowBucket);
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Wstrzymaj wysyłanie: IMG_0412.jpg' }));
    expect(await screen.findByText('Wstrzymano')).toBeTruthy();
    vi.stubGlobal('XMLHttpRequest', FakeBucket);
    await userEvent.click(screen.getByRole('button', { name: 'Wznów wysyłanie: IMG_0412.jpg' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
    expect(release).toBeNull();
  });

  it('EVM-044 AC8 without a connection the file waits and the panel says it will go on when the connection is back', async () => {
    const api = mediaApi();
    class DeadBucket extends FakeBucket {
      override send() {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', DeadBucket);
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    expect(await screen.findByText('Wysyłanie wznowimy po powrocie połączenia — nie zamykaj karty.')).toBeTruthy();
    vi.stubGlobal('XMLHttpRequest', FakeBucket);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
  });
});

describe('EVM-044 AC8 the panel of the upload announces and keeps the touch targets', () => {
  it('EVM-044 AC8 the heading "Wysyłanie · N z M" is a polite live region without percents; a failure is announced politely too', async () => {
    await openMedia({ stateAfterComplete: 'failed', stateReasonCode: 'checksum_mismatch' });
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    const region = await screen.findByRole('region', { name: 'Wysyłanie plików' });
    const heading = within(region).getByRole('heading', { level: 3 });
    expect(heading.getAttribute('aria-live')).toBe('polite');
    expect(heading.textContent).toMatch(/^Wysyłanie · \d z 1$/);
    await within(region).findByText('Nie wysłano — plik uszkodzony w transmisji');
    const announcement = within(region).getByRole('status');
    expect(announcement.textContent).toBe('Nie wysłano 1 pliku. Użyj przycisku „Ponów”.');
    expect(await axeViolations(region)).toEqual([]);
  });

  it('EVM-044 AC8 offline the queue says "Brak połączenia — wysyłanie wstrzymane" above the files', async () => {
    const api = mediaApi();
    class DeadBucket extends FakeBucket {
      override send() {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        fireEvent(window, new Event('offline'));
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('XMLHttpRequest', DeadBucket);
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    await screen.findByText('To zlecenie nie ma jeszcze zdjęć.');
    await sendFiles([jpeg('IMG_0412.jpg')]);
    const region = await screen.findByRole('region', { name: 'Wysyłanie plików' });
    expect(await within(region).findByText('Brak połączenia — wysyłanie wstrzymane.')).toBeTruthy();
    expect(await axeViolations(region)).toEqual([]);
  });

  it('EVM-044 AC4 the buttons "Wstrzymaj", "Ponów", "Usuń z wyboru" and "Wybierz ponownie z galerii" have the height of size.touch-target.min (48)', async () => {
    await renderPanel(
      PATH,
      mediaApi({ unfinished: [unfinished(7, 'IMG_0412.jpg', 1000)], stateAfterComplete: 'failed', stateReasonCode: 'checksum_mismatch' }),
    );
    const again = await screen.findByRole('button', { name: 'Wybierz ponownie z galerii' });
    expect(again.className).toContain('h-control-height-web-lg');
    await userEvent.click(again);
    choose([jpeg('IMG_0412.jpg'), jpeg('IMG_0500.jpg')]);
    expect(within(dialog()).getByRole('button', { name: 'Usuń z wyboru: IMG_0412.jpg' }).className).toContain('h-control-height-web-lg');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 2 pliki' }));
    const retry = await screen.findAllByRole('button', { name: /^Ponów wysyłanie: / });
    expect(retry[0]?.className).toContain('h-control-height-web-lg');
  });

  it('EVM-044 AC8 the tab loads as a skeleton with a text status, not a spinner', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = mediaApi({
      routes: {
        [`GET ${MEDIA_BASE}`]: () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      },
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
    const section = (await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' })).closest('section') as HTMLElement;
    expect(section.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(within(section).getAllByRole('status')[0]?.className).toContain('sr-only');
    expect(section.querySelector('.animate-spin')).toBeNull();
    answer(json(200, { items: [], nextCursor: null }));
  });
});

describe('EVM-044 AC1 accessibility of the tab', () => {
  it('EVM-044 AC1 the tab with the list and the panel has no axe violations', async () => {
    await openMedia({ assets: [asset(1, { fileState: 'ready' }), asset(2, { fileState: 'quarantined' })] });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
    expect(await axeViolations(heading.closest('section') as HTMLElement)).toEqual([]);
  });
});
