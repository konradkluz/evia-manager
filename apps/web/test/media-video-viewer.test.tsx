import type { MediaAsset } from '@evia/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { refreshDelay, REFRESH_MARGIN_MS } from '../src/work-orders/media-video-player.tsx';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, type Handler } from './api-fake.ts';
import { THUMBNAIL_HOST, asset, mediaApi } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// The lightbox with a film (EVM-046 AC3, AC4, AC6): the player of the preview 720p, the keyboard, the renewal of a short-lived address.
const PATH = `/work-orders/${ORDER_ID}`;
const READ_ONLY = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' as const } };
const NOW = Date.parse('2026-10-31T10:00:00.000Z');
const ADDRESS_SECONDS = 300;

const clip = (n: number, extra: Partial<MediaAsset> = {}) =>
  asset(n, { mediaType: 'video', fileState: 'ready', category: 'measurement', durationSeconds: 242, ...extra });

let issued = 0;
/** Every answer for a preview is a new address that lives 300 s from "now" (the server's rule); the order of issuing is in the address. */
const previews: Handler = (request) => {
  const variant = (parseBody(request.body) as { variant: string }).variant;
  const id = request.path.split('/').at(-2) ?? '';
  issued += 1;
  return json(200, {
    url: `${THUMBNAIL_HOST}/media/${id}/${variant === 'preview' ? 'preview.mp4' : `${variant}.webp`}?n=${String(issued)}`,
    expiresAt: new Date(Date.now() + ADDRESS_SECONDS * 1000).toISOString(),
  });
};

const asked = (api: ReturnType<typeof mediaApi>, variant: string) =>
  api.requests.filter((entry) => entry.path.endsWith('/download-url') && (parseBody(entry.body) as { variant: string }).variant === variant)
    .length;

/** The timers that wait for the end of an address are caught (the clock of the test): a real wait of minutes is no test. */
let caught: Array<{ delay: number; run: () => void }> = [];
let play: MockInstance;
let pause: MockInstance;

beforeEach(() => {
  issued = 0;
  caught = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const realSet = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, delay?: number, ...rest: unknown[]) => {
    if (typeof delay === 'number' && delay >= 100_000) {
      caught.push({ delay, run });
      return 0;
    }
    return realSet(run, delay, ...(rest as []));
  }) as typeof setTimeout);
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openFilm(options: Parameters<typeof mediaApi>[0] = {}) {
  const api = mediaApi({ downloadUrl: previews, ...options });
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  const [tile] = await screen.findAllByRole('button', { name: /^Odtwórz: Film/ });
  await userEvent.click(tile as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: /\(1 z / });
  const video = await waitFor(() => {
    const found = dialog.querySelector('video');
    if (found === null) throw new Error('no video yet');
    return found;
  });
  return { api, dialog, video };
}

/** A video element that remembers its position, the way a browser does (jsdom keeps none). */
function withPosition(video: HTMLVideoElement, start = 0) {
  const state = { time: start, paused: true };
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => state.time,
    set: (value: number) => {
      state.time = value;
    },
  });
  Object.defineProperty(video, 'paused', { configurable: true, get: () => state.paused });
  Object.defineProperty(video, 'duration', { configurable: true, get: () => 242 });
  return state;
}

describe('EVM-046 AC4 the lightbox plays the preview 720p', () => {
  it('EVM-046 AC4 a film opens in a player with controls, the preview 720p from the signed address, without autoplay and without crossorigin', async () => {
    const { api, dialog, video } = await openFilm({ assets: [clip(1)] });
    expect(video.getAttribute('src')).toMatch(/\/preview\.mp4\?n=\d+$/);
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('crossorigin')).toBe(false);
    expect(video.getAttribute('aria-label')).toMatch(/^Podgląd 720p: Film · Pomiary/);
    expect(asked(api, 'preview')).toBe(1);
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Powiększ' }).disabled).toBe(true);
    expect(within(dialog).getByText(/Spacja — odtwarzanie i pauza/)).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-046 AC4 Space plays and pauses, the arrows wind by 5 s without leaving the film, F goes full screen', async () => {
    const { dialog, video } = await openFilm({ assets: [clip(1), clip(2)] });
    const position = withPosition(video, 20);
    video.focus();
    await userEvent.keyboard(' ');
    expect(play).toHaveBeenCalledTimes(1);
    position.paused = false;
    await userEvent.keyboard(' ');
    expect(pause).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{ArrowRight}');
    expect(position.time).toBe(25);
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(position.time).toBe(15);
    position.time = 2;
    await userEvent.keyboard('{ArrowLeft}');
    expect(position.time).toBe(0);
    position.time = 240;
    await userEvent.keyboard('{ArrowRight}');
    expect(position.time).toBe(242);
    // the arrows of the player never turn the page of the lightbox
    expect(screen.getByRole('dialog', { name: /\(1 z 2\)/ })).toBeTruthy();

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    const fullscreen = vi.fn(() => Promise.resolve());
    video.requestFullscreen = fullscreen;
    await userEvent.keyboard('f');
    expect(fullscreen).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: video });
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    await userEvent.keyboard('F');
    expect(exit).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, 'fullscreenElement');

    // out of the player the arrows still go to the next film
    within(dialog).getByRole('button', { name: 'Następne' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: /\(2 z 2\)/ })).toBeTruthy();
  });
});

describe('EVM-046 AC3 AC6 the film that was not scanned and the roles', () => {
  it('EVM-046 AC3 the lightbox and the question about the original carry the mark; the original is offered to the Editor as a download', async () => {
    const { dialog } = await openFilm({ assets: [clip(1, { avScanned: false })] });
    expect(within(dialog).getByText('Nieskanowany antywirusem — plik za duży')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pobierz oryginał' }));
    const ask = await screen.findByRole('dialog', { name: 'Pobrać oryginał?' });
    expect(within(ask).getByText('Nieskanowany antywirusem — plik za duży')).toBeTruthy();
    expect(await axeViolations(ask)).toEqual([]);
  });

  it('EVM-046 AC6 Tylko odczyt watches the preview and has no button for the original', async () => {
    const { api, dialog, video } = await openFilm({ assets: [clip(1)], session: READ_ONLY });
    expect(video.getAttribute('src')).toMatch(/preview\.mp4/);
    expect(within(dialog).queryByRole('button', { name: 'Pobierz oryginał' })).toBeNull();
    expect(asked(api, 'original')).toBe(0);
  });
});

describe('EVM-046 AC4 the address of the preview lives 300 s and a film lasts up to 30 min', () => {
  it('EVM-046 AC4 the delay before the renewal is the end of the address less a margin, never negative', () => {
    const now = NOW;
    expect(refreshDelay(new Date(now + 300_000).toISOString(), now)).toBe(300_000 - REFRESH_MARGIN_MS);
    expect(refreshDelay(new Date(now + 10_000).toISOString(), now)).toBe(0);
    expect(refreshDelay(new Date(now - 5_000).toISOString(), now)).toBe(0);
  });

  it('EVM-046 AC4 an error of the film (the address ran out in the middle of a Range request) asks for a new address once and goes back to the second where it was, still playing', async () => {
    const { api, video } = await openFilm({ assets: [clip(1)] });
    const position = withPosition(video, 95);
    position.paused = false;
    const first = video.getAttribute('src');
    fireEvent.error(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(first);
    });
    expect(asked(api, 'preview')).toBe(2);
    position.time = 0;
    fireEvent.loadedMetadata(video);
    expect(position.time).toBe(95);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('EVM-046 AC4 a film that was stopped stays stopped after the renewal (no autoplay)', async () => {
    const { video } = await openFilm({ assets: [clip(1)] });
    const position = withPosition(video, 61);
    const first = video.getAttribute('src');
    fireEvent.error(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(first);
    });
    position.time = 0;
    fireEvent.loadedMetadata(video);
    expect(position.time).toBe(61);
    expect(play).not.toHaveBeenCalled();
  });

  it('EVM-046 AC4 one try per error: when the new address fails too, the player says so (W-09) and asks for no third address', async () => {
    const { api, dialog, video } = await openFilm({ assets: [clip(1)] });
    withPosition(video, 10);
    const first = video.getAttribute('src');
    fireEvent.error(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(first);
    });
    fireEvent.error(video);
    expect(await within(dialog).findByText('Nie można odtworzyć filmu. Zamknij podgląd i otwórz go ponownie.')).toBeTruthy();
    expect(asked(api, 'preview')).toBe(2);
    expect(dialog.querySelector('video')).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-046 AC4 once the renewed film has loaded, a later error gets a new try again', async () => {
    const { api, video } = await openFilm({ assets: [clip(1)] });
    withPosition(video, 10);
    let current = video.getAttribute('src');
    fireEvent.error(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(current);
    });
    fireEvent.loadedData(video);
    current = video.getAttribute('src');
    fireEvent.error(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(current);
    });
    expect(asked(api, 'preview')).toBe(3);
  });

  it('EVM-046 AC4 when the renewal itself is refused (for instance 403), the player says so', async () => {
    let calls = 0;
    const { dialog, video } = await openFilm({
      assets: [clip(1)],
      downloadUrl: (request) => {
        if ((parseBody(request.body) as { variant: string }).variant !== 'preview') return previews(request);
        calls += 1;
        return calls === 1 ? previews(request) : problem(403, 'forbidden');
      },
    });
    fireEvent.error(video);
    expect(await within(dialog).findByText('Nie można odtworzyć filmu. Zamknij podgląd i otwórz go ponownie.')).toBeTruthy();
  });

  it('EVM-046 AC4 shortly before the address ends a film that is stopped gets a new address by itself and keeps its place', async () => {
    const { api, video } = await openFilm({ assets: [clip(1)] });
    const position = withPosition(video, 33);
    const timer = caught.find((entry) => entry.delay === ADDRESS_SECONDS * 1000 - REFRESH_MARGIN_MS);
    expect(timer).toBeTruthy();
    const first = video.getAttribute('src');
    // a minute has passed on the clock: the new address ends later than the old one
    vi.setSystemTime(new Date(NOW + 60_000));
    act(() => {
      timer?.run();
    });
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(first);
    });
    position.time = 0;
    fireEvent.loadedMetadata(video);
    expect(position.time).toBe(33);
    expect(asked(api, 'preview')).toBe(2);
    // the new address has its own clock
    expect(caught.filter((entry) => entry.delay === ADDRESS_SECONDS * 1000 - REFRESH_MARGIN_MS)).toHaveLength(2);
  });

  it('EVM-046 AC4 a film that is playing is not interrupted at the margin: the renewal waits for the pause', async () => {
    const { api, video } = await openFilm({ assets: [clip(1)] });
    const position = withPosition(video, 40);
    position.paused = false;
    const first = video.getAttribute('src');
    act(() => {
      caught.find((entry) => entry.delay === ADDRESS_SECONDS * 1000 - REFRESH_MARGIN_MS)?.run();
    });
    expect(asked(api, 'preview')).toBe(1);
    position.paused = true;
    fireEvent.pause(video);
    await waitFor(() => {
      expect(video.getAttribute('src')).not.toBe(first);
    });
    expect(asked(api, 'preview')).toBe(2);
  });
});
