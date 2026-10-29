import type { MediaAsset } from '@evia/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/api-context.tsx';
import { createApiClient } from '../src/api/client.ts';
import { groupByCategory, MediaGallery } from '../src/work-orders/media-gallery.tsx';
import {
  MEDIA_GIVE_UP_AFTER_MS,
  MEDIA_POLL_MS,
  MEDIA_SLOW_AFTER_MS,
  MEDIA_SLOW_POLL_MS,
  mediaPollInterval,
} from '../src/work-orders/use-media.ts';
import { MAX_PARALLEL_URL_REQUESTS, RequestLimiter } from '../src/work-orders/media-thumbnails.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, type Handler } from './api-fake.ts';
import { THUMBNAIL_HOST, asset, mediaApi } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 gallery (EVM-068 AC1, AC4, AC6, AC8): the groups with their counts, the tiles that fetch their thumbnail lazily, a few at a time, the states of a tile.
const PATH = `/work-orders/${ORDER_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

const ready = (n: number, category: MediaAsset['category'] = 'in_progress', extra: Partial<MediaAsset> = {}) =>
  asset(n, { fileState: 'ready', category, ...extra });

async function openMedia(options: Parameters<typeof mediaApi>[0] = {}) {
  const api = mediaApi(options);
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

describe('EVM-068 AC1 the gallery: 24 + 12 photos, the groups with counts, the thumbnails fetched lazily', () => {
  it('EVM-068 AC1 "Zdjęcia i filmy · 36 zdjęć", the groups "W trakcie prac (24)" and "Stan przed pracami (12)" and a thumbnail from the domain of the bucket for each tile', async () => {
    const assets = [
      ...Array.from({ length: 24 }, (_, index) => ready(index + 1, 'in_progress')),
      ...Array.from({ length: 12 }, (_, index) => ready(100 + index, 'before_work')),
    ];
    const api = await openMedia({ assets });
    expect(await screen.findByRole('heading', { level: 3, name: 'Zdjęcia i filmy · 36 zdjęć' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'W trakcie prac (24)' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'Stan przed pracami (12)' })).toBeTruthy();
    const progress = screen.getByRole('list', { name: 'W trakcie prac' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(24);
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(36);
    });
    for (const image of screen.getAllByRole('img')) {
      expect(image.getAttribute('src')?.startsWith(`${THUMBNAIL_HOST}/`)).toBe(true);
      expect(image.getAttribute('alt')).toMatch(/^Zdjęcie · (W trakcie prac|Przed pracami) · \d\d\.\d\d\.2026$/);
      expect(image.getAttribute('loading')).toBe('lazy');
      expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    }
    // the request for an address is a POST with the variant in the body, never a GET with an address in the path
    const requests = api.requests.filter((entry) => entry.path.endsWith('/download-url'));
    expect(requests).toHaveLength(36);
    expect(requests.every((entry) => entry.method === 'POST')).toBe(true);
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ variant: 'thumbnail' });
    expect(
      await axeViolations(screen.getByRole('heading', { level: 2, name: 'Media i dokumenty' }).closest('section') as HTMLElement),
    ).toEqual([]);
  });

  it('EVM-068 AC1 at most six addresses are asked for at the same time (the gallery of 5000 media must not flood the issuing of addresses)', async () => {
    let running = 0;
    let most = 0;
    const slow: Handler = async (request) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return json(200, { url: `${THUMBNAIL_HOST}/${request.path.split('/').at(-2) ?? ''}.webp`, expiresAt: '2026-10-11T12:05:00.000Z' });
    };
    await openMedia({ assets: Array.from({ length: 30 }, (_, index) => ready(index + 1)), downloadUrl: slow });
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(30);
    });
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(MAX_PARALLEL_URL_REQUESTS);
    expect(MAX_PARALLEL_URL_REQUESTS).toBe(6);
  });

  it('EVM-068 AC1 only the tiles that have come into view ask for an address (IntersectionObserver)', async () => {
    const observed: Array<{ element: Element; callback: IntersectionObserverCallback }> = [];
    class FakeObserver {
      readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(element: Element) {
        observed.push({ element, callback: this.callback });
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const api = await openMedia({ assets: Array.from({ length: 12 }, (_, index) => ready(index + 1)) });
    await waitFor(() => {
      expect(observed).toHaveLength(12);
    });
    expect(api.requests.filter((entry) => entry.path.endsWith('/download-url'))).toHaveLength(0);
    // two tiles scroll into view
    for (const { element, callback } of observed.slice(0, 2)) {
      callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(2);
    });
    expect(api.requests.filter((entry) => entry.path.endsWith('/download-url'))).toHaveLength(2);
  });
});

describe('EVM-068 AC8 the states of a tile', () => {
  it('EVM-068 AC8 while the address is awaited the tile is a Skeleton with a text status for a screen reader, not a broken picture', async () => {
    const pending: Handler = () => new Promise<Response>(() => undefined);
    await openMedia({ assets: [ready(1)], downloadUrl: pending });
    expect(await screen.findByText('Wczytywanie miniatury')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('EVM-068 AC8 a thumbnail that cannot be had (the server says 404, or the picture does not load twice) is the icon and "Nie można wyświetlić"', async () => {
    await openMedia({ assets: [ready(1)], downloadUrl: () => problem(404, 'not_found') });
    expect(await screen.findByText('Nie można wyświetlić')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Zdjęcie/ })).toBeNull();
  });

  it('EVM-068 AC8 a picture that fails to load asks for a fresh address once; a second failure is "Nie można wyświetlić"', async () => {
    const api = await openMedia({ assets: [ready(1)] });
    const image = await screen.findByRole('img');
    fireEvent.error(image);
    await waitFor(() => {
      expect(api.requests.filter((entry) => entry.path.endsWith('/download-url'))).toHaveLength(2);
    });
    fireEvent.error(await screen.findByRole('img'));
    expect(await screen.findByText('Nie można wyświetlić')).toBeTruthy();
    expect(api.requests.filter((entry) => entry.path.endsWith('/download-url'))).toHaveLength(2);
  });

  it('EVM-068 AC8 an order without photos is the EmptyState of W-09', async () => {
    await openMedia({ assets: [] });
    expect(await screen.findByText('To zlecenie nie ma jeszcze zdjęć.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('EVM-068 AC8 offline the tiles already loaded stay with a banner, nothing is requested again, and a tile that was never loaded waits for the connection', async () => {
    const api = await openMedia({ assets: [ready(1), ready(2)] });
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(2);
    });
    const before = api.requests.length;
    const sources = screen.getAllByRole('img').map((image) => image.getAttribute('src'));
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText(/^Brak połączenia\. Pokazujemy zdjęcia zapamiętane w tej karcie/)).toBeTruthy();
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual(sources);
    expect(api.requests.slice(before).filter((entry) => entry.path.endsWith('/download-url'))).toEqual([]);
  });

  it('EVM-068 AC8 a tile that was never loaded does not ask for an address offline and asks when the connection is back', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const api = await openMedia({ assets: [ready(1)] });
    expect(await screen.findByText('Brak połączenia — miniatura wczyta się po jego powrocie.')).toBeTruthy();
    expect(api.requests.some((entry) => entry.path.endsWith('/download-url'))).toBe(false);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    fireEvent(window, new Event('online'));
    expect(await screen.findByRole('img')).toBeTruthy();
  });

  it('EVM-068 AC4 a photo whose derivatives could not be made says so, a photo still being made says "Przygotowujemy podgląd."', async () => {
    await openMedia({
      assets: [
        asset(1, { fileState: 'failed', processingFailed: true }),
        asset(2, { fileState: 'processing' }),
        asset(3, { fileState: 'clean' }),
      ],
    });
    expect(await screen.findByText('Nie udało się przygotować podglądu. Spróbujemy ponownie.')).toBeTruthy();
    expect(screen.getAllByText('Przygotowujemy podgląd.')).toHaveLength(2);
  });
});

describe('EVM-068 AC1 the heading counts photos and videos apart; a video does not keep the list polling', () => {
  it('EVM-068 AC1 a mix of photos, a video and a file still being checked: "2 zdjęcia, 1 film" and no promise of a preview for the video', async () => {
    await openMedia({
      assets: [ready(1), ready(2), asset(3, { mediaType: 'video', fileState: 'clean' }), asset(4, { fileState: 'scanning' })],
    });
    expect(await screen.findByRole('heading', { level: 3, name: 'Zdjęcia i filmy · 3 zdjęcia, 1 film' })).toBeTruthy();
    expect(screen.queryByText('Przygotowujemy podgląd.')).toBeNull();
  });

  it('EVM-068 AC4 a video that stays `clean` does not make the list poll; a photo that is `processing` does, slower and slower, and gives up', () => {
    const video = { mediaType: 'video', fileState: 'clean' } as const;
    const photo = { mediaType: 'photo', fileState: 'processing' } as const;
    expect(mediaPollInterval([video], 0)).toBe(false);
    expect(mediaPollInterval([video, { mediaType: 'photo', fileState: 'ready' }], 0)).toBe(false);
    expect(mediaPollInterval([photo], 0)).toBe(MEDIA_POLL_MS);
    expect(mediaPollInterval([photo], MEDIA_SLOW_AFTER_MS)).toBe(MEDIA_SLOW_POLL_MS);
    expect(mediaPollInterval([photo], MEDIA_GIVE_UP_AFTER_MS)).toBe(false);
    expect(mediaPollInterval([photo], MEDIA_GIVE_UP_AFTER_MS, true)).toBe(MEDIA_POLL_MS);
    expect(mediaPollInterval([{ mediaType: 'video', fileState: 'scanning' }], MEDIA_GIVE_UP_AFTER_MS)).toBe(MEDIA_POLL_MS);
    expect(mediaPollInterval([], 0, true)).toBe(MEDIA_POLL_MS);
  });
});

/** Every key and value of a storage of the browser as one text. */
const dump = (storage: Storage): string =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
    .map((key) => `${key}=${storage.getItem(key) ?? ''}`)
    .join(' | ');

describe('EVM-068 AC6 the address lives in the memory of the tab only and a loaded picture is never replaced', () => {
  const stub = (answer: Handler) => {
    const api = mediaApi({ downloadUrl: answer });
    return createApiClient(api.fetch);
  };

  it('EVM-068 AC6 a new list of the same photos does not change the address of a tile that has been loaded; nothing goes to the storage of the browser', async () => {
    let counter = 0;
    const client = stub(() => {
      counter += 1;
      return json(200, { url: `${THUMBNAIL_HOST}/a-${String(counter)}.webp`, expiresAt: '2026-10-11T12:05:00.000Z' });
    });
    const photo = ready(1);
    const view = (assets: MediaAsset[]) => (
      <ApiProvider client={client}>
        <MediaGallery workOrderId={ORDER_ID} assets={assets} online />
      </ApiProvider>
    );
    const { rerender } = render(view([photo]));
    const image = await screen.findByRole('img');
    fireEvent.load(image);
    const first = image.getAttribute('src');
    rerender(view([{ ...photo }]));
    rerender(view([{ ...photo }, ready(2)]));
    await waitFor(() => {
      expect(screen.getAllByRole('img')).toHaveLength(2);
    });
    expect(screen.getAllByRole('img')[0]?.getAttribute('src')).toBe(first);
    expect(counter).toBe(2);
    expect(dump(localStorage)).not.toContain('X-Amz');
    expect(dump(sessionStorage)).not.toContain('X-Amz');
  });
});

describe('EVM-068 AC1 the helpers of the gallery', () => {
  it('EVM-068 AC1 the groups are ordered work in progress, before, after, survey, defect, measurement, other; an unknown category is "Inne"', () => {
    const groups = groupByCategory([
      ready(1, 'defect'),
      ready(2, 'other'),
      ready(3, 'before_work'),
      ready(4, 'in_progress'),
      ready(5, 'something_new' as MediaAsset['category']),
      ready(6, 'completed_work'),
    ]);
    expect(groups.map((group) => [group.category, group.assets.length])).toEqual([
      ['in_progress', 1],
      ['before_work', 1],
      ['completed_work', 1],
      ['defect', 1],
      ['other', 2],
    ]);
    expect(groupByCategory([])).toEqual([]);
  });

  it('EVM-068 AC1 the limiter runs the tasks in order, at most `max` at a time, and goes on after a failed task', async () => {
    const limiter = new RequestLimiter(2);
    let running = 0;
    let most = 0;
    const task =
      (fail = false) =>
      async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        if (fail) throw new Error('boom');
        return 'ok';
      };
    const results = await Promise.allSettled([
      limiter.run(task()),
      limiter.run(task(true)),
      limiter.run(task()),
      limiter.run(task()),
      limiter.run(task()),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(most).toBe(2);
    expect(await limiter.run(() => Promise.resolve(7))).toBe(7);
  });
});

describe('EVM-068 AC7 the thumbnails are shown to every role of the web', () => {
  it('EVM-068 AC7 Tylko odczyt sees the gallery too (the server decides all the same)', async () => {
    await openMedia({ session: { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } }, assets: [ready(1)] });
    expect(await screen.findByRole('img')).toBeTruthy();
  });
});
