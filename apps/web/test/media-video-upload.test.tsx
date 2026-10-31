import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { MEDIA_BASE, mediaApi, unfinished, type MediaServerOptions } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 and W-09 compact: films in the upload dialog (EVM-046 AC1, AC7, AC8).
const PATH = `/work-orders/${ORDER_ID}`;

class FakeBucket {
  static puts: { size: number }[] = [];
  withCredentials = true;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  open() {
    /* the address is of no interest here */
  }
  send(body: Blob) {
    FakeBucket.puts.push({ size: body.size });
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size });
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

/** A file that claims a size (a 600 MB film is not allocated in a test); the bytes are few. */
function film(name: string, size: number, type = 'video/mp4'): File {
  const file = new File([new Uint8Array(1000)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}
const jpeg = (name: string) => new File([new Uint8Array(1000)], name, { type: 'image/jpeg' });

/** jsdom plays nothing: the metadata of a film is answered by the name of the blob address - `blob:<name>` - from this table. */
function stubDurations(seconds: Record<string, number>) {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => `blob:${blob instanceof File ? blob.name : 'x'}`,
      revokeObjectURL: () => undefined,
    }),
  );
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    configurable: true,
    set(this: HTMLMediaElement, value: string) {
      const name = value.replace('blob:', '');
      Object.defineProperty(this, 'duration', { configurable: true, value: seconds[name] ?? Number.NaN });
      queueMicrotask(() => {
        this.onloadedmetadata?.(new Event('loadedmetadata'));
      });
    },
    get() {
      return '';
    },
  });
}

beforeEach(() => {
  FakeBucket.puts = [];
  vi.stubGlobal('XMLHttpRequest', FakeBucket);
});

afterEach(() => {
  // the property of the prototype is removed so that the next file starts from the real jsdom element
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'src');
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
const choose = (files: File[]) => {
  fireEvent.change(within(dialog()).getByLabelText('Wybrane pliki'), { target: { files } });
};
const openDialog = () => userEvent.click(screen.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }));

describe('EVM-046 AC1 a film is sent in parts with the category "Pomiary"', () => {
  it('EVM-046 AC1 a film of 600 MB and 4 min goes to the API as a film with the category Pomiary, in parts, and ends as "Wysłano film"', async () => {
    stubDurations({ 'VID_0415.mp4': 242 });
    const api = await openMedia({ partCount: 3 });
    await openDialog();
    expect(dialog().textContent).toContain('Filmy: MP4, MOV do 4 GB i 30 min.');
    choose([film('VID_0415.mp4', 600_000_000)]);
    expect(await within(dialog()).findByText('Wybrano 1 plik · 600 MB')).toBeTruthy();
    await userEvent.selectOptions(within(dialog()).getByRole('combobox', { name: 'Kategoria' }), 'measurement');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 1 plik' }));
    // 600 MB is over the threshold: the warning comes first (AC8) and nothing has been sent yet
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Wyślij teraz' }));

    expect(await screen.findByText('Wysłano film — możesz go usunąć z telefonu. Potem opróżnij kosz galerii.')).toBeTruthy();
    const [create] = api.calls(`POST ${MEDIA_BASE}`);
    expect(JSON.parse(create?.body ?? '{}')).toMatchObject({
      items: [{ category: 'measurement', fileName: 'VID_0415.mp4', declaredSize: 600_000_000, contentType: 'video/mp4' }],
    });
    // three parts of 16 MiB are fetched and sent one by one
    expect(FakeBucket.puts).toHaveLength(3);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('EVM-046 AC1 a film longer than 30 min, over 4 GB or in another format is refused with a message and is not sent', async () => {
    stubDurations({ 'dlugi.mp4': 1801, 'krotki.mp4': 1800 });
    await openMedia();
    await openDialog();
    choose([
      film('dlugi.mp4', 50_000_000),
      film('olbrzym.mp4', 4_294_967_297),
      film('stary.avi', 50_000_000, 'video/x-msvideo'),
      film('krotki.mp4', 50_000_000),
    ]);
    expect(await within(dialog()).findByText('Wybrano 1 plik · 50 MB')).toBeTruthy();
    const skipped = within(dialog()).getByRole('status');
    expect(within(skipped).getByText('Pominięto 3 pliki:')).toBeTruthy();
    expect(within(skipped).getByText('Film jest dłuższy niż 30 min. Plik „dlugi.mp4” nie został wybrany.')).toBeTruthy();
    expect(within(skipped).getByText('Plik „olbrzym.mp4” jest większy niż 4 GB. Wybierz krótszy film.')).toBeTruthy();
    expect(within(skipped).getByText('Plik „stary.avi” ma nieobsługiwany format. Wybierz film MP4 albo MOV.')).toBeTruthy();
    expect(FakeBucket.puts).toHaveLength(0);
  });

  it('EVM-046 AC1 a film the browser cannot read is sent all the same - the server measures it', async () => {
    stubDurations({});
    await openMedia();
    await openDialog();
    choose([film('hevc.mov', 50_000_000, 'video/quicktime')]);
    expect(await within(dialog()).findByText('Wybrano 1 plik · 50 MB')).toBeTruthy();
    expect(within(dialog()).queryByRole('status')).toBeNull();
  });
});

describe('EVM-046 AC8 the warning before a large film (W-09 compact)', () => {
  it('EVM-046 AC8 a film of 600 MB gets the warning with "Wyślij teraz" and "Anuluj"; "Anuluj" returns to the list and sends nothing', async () => {
    stubDurations({ 'VID_0415.mp4': 242 });
    await openMedia();
    await openDialog();
    choose([film('VID_0415.mp4', 600_000_000), jpeg('IMG_1.jpg')]);
    await within(dialog()).findByText('Wybrano 2 pliki · 600 MB');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 2 pliki' }));
    expect(
      await within(dialog()).findByText(
        'Film ma 600 MB. Przez sieć komórkową wysyłanie zużyje pakiet danych i może potrwać długo — najlepiej wyślij przez Wi-Fi.',
      ),
    ).toBeTruthy();
    expect(within(dialog()).getByText('VID_0415.mp4')).toBeTruthy();
    expect(within(dialog()).getByText('Razem z filmem wyślemy 1 zdjęcie.')).toBeTruthy();
    expect(await axeViolations(dialog())).toEqual([]);
    expect(FakeBucket.puts).toHaveLength(0);

    await userEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    // back to the chosen files, unchanged and not sent
    expect(await within(dialog()).findByText('Wybrano 2 pliki · 600 MB')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Usuń z wyboru: VID_0415.mp4' })).toBeTruthy();
    expect(FakeBucket.puts).toHaveLength(0);
  });

  it('EVM-046 AC8 a film of 100 MB or less is sent at once, without the warning', async () => {
    stubDurations({ 'maly.mp4': 20 });
    await openMedia();
    await openDialog();
    choose([film('maly.mp4', 100_000_000)]);
    await within(dialog()).findByText('Wybrano 1 plik · 100 MB');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 1 plik' }));
    expect(await screen.findByText(/^Wysłano film — możesz go usunąć z telefonu\./)).toBeTruthy();
  });

  it('EVM-046 AC8 the film can be taken off the choice after the warning, so that only the photos are sent', async () => {
    stubDurations({ 'VID_0415.mp4': 242 });
    await openMedia();
    await openDialog();
    choose([film('VID_0415.mp4', 600_000_000), jpeg('IMG_1.jpg')]);
    await within(dialog()).findByText('Wybrano 2 pliki · 600 MB');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 2 pliki' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Usuń z wyboru: VID_0415.mp4' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 1 plik' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
  });

  it('EVM-046 AC8 after a closed tab the banner says which film was not sent, and the same film chosen again resumes its session', async () => {
    stubDurations({ 'VID_0415.mp4': 242 });
    const api = await openMedia({
      unfinished: [unfinished(7, 'VID_0415.mp4', 600_000_000, { mediaType: 'video' })],
      partCount: 1,
    });
    const banner = await screen.findByRole('region', { name: 'Niedokończone wysyłanie filmów' });
    expect(within(banner).getByText('Nie wysłano filmu „VID_0415.mp4” — wybierz go ponownie z galerii.')).toBeTruthy();
    expect(await axeViolations(banner)).toEqual([]);
    await userEvent.click(within(banner).getByRole('button', { name: 'Wybierz ponownie z galerii' }));
    choose([film('VID_0415.mp4', 600_000_000)]);
    await within(dialog()).findByText('Wybrano 1 plik · 600 MB');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wyślij 1 plik' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Wyślij teraz' }));
    await waitFor(() => {
      expect(FakeBucket.puts).toHaveLength(1);
    });
    // the medium that was made earlier is continued, none is made again
    expect(api.calls(`POST ${MEDIA_BASE}`)).toHaveLength(0);
  });
});
