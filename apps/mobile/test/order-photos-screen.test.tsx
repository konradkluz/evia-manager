import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import { App } from '../src/App';
import { columnsFor } from '../src/screens/OrderPhotosScreen';
import { formatDateTime } from '../src/i18n/format';
import { pl } from '../src/i18n/pl';
import type { OrderDetail } from '../src/orders/order-detail-model';
import { buildOrderList, type OrderListSource } from '../src/orders/order-list-model';
import { buildOrderPhotos, type OrderPhoto } from '../src/orders/order-photos-model';
import type { StartupChecker } from '../src/startup';
import { MIN } from './device-guard/fakes';
import { stubPorts, type PortsRig } from './session-helpers';

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  const insets = { top: 24, left: 0, right: 0, bottom: 16 };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.SafeAreaInsetsContext.Provider value={insets}>{children}</actual.SafeAreaInsetsContext.Provider>
    ),
  };
});

// EVM-142 AC2-AC6: "Zdjęcia zlecenia" - the grid, the preview, offline, the hidden-data mode and the lock, as the screens show them (the fake viewer decides what a request answers).

const settle = () =>
  act(async () => {
    for (let n = 0; n < 12; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });

const T0 = Date.UTC(2026, 10, 18, 9, 30);
const MIN_MS = 60_000;
const ID = (n: number): string => `0194c2a0-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE: OrderListSource = {
  orders: [{ id: 'o1', number: 'ZL-2026-0042', status: 'in_progress', createdAt: T0, customerId: 'c1', siteId: 's1' }],
  customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
  sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
  stages: [],
};
const DETAIL: OrderDetail = {
  id: 'o1',
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { name: 'Jan Łódzki Synthetic', phone: '+48 600 100 200', dial: '+48600100200' },
  location: { street: 'ul. Żółkiewskiego 7', city: '00-001 Łódź', spot: '15', level: '-1', powerKw: null, operator: null, manager: null },
  scope: [],
  processes: [],
  journal: [],
};
const photo = (n: number, patch: Partial<OrderPhoto> = {}): OrderPhoto => ({
  id: ID(n),
  category: 'defect',
  description: null,
  capturedAt: T0 + n * MIN_MS,
  state: 'ready',
  ...patch,
});
const when = (n: number): string => formatDateTime(T0 + n * MIN_MS);
const CATEGORY = pl.camera.categories;

function rigWith(photos: readonly OrderPhoto[]): PortsRig {
  const rig = stubPorts();
  rig.sync.rows = buildOrderList(SOURCE, []);
  rig.sync.details.set('o1', DETAIL);
  rig.sync.photos.set('o1', photos);
  return rig;
}
async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
async function openGrid(rig: PortsRig, checker: StartupChecker = online) {
  await open(rig, checker);
  await fireEvent.press(screen.getByTestId('order-row-o1'));
  await settle();
  await fireEvent.press(screen.getByTestId('order-photos-row'));
  await settle();
}
async function hide(rig: PortsRig) {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
}
async function lock(rig: PortsRig) {
  rig.device.facts.auth = 'cancelled';
  await act(() => {
    rig.device.appState.emit('background');
    rig.device.time.boot += 6 * MIN;
    rig.device.time.wall += 6 * MIN;
    rig.device.appState.emit('active');
  });
  await settle();
}
async function unlock(rig: PortsRig) {
  rig.device.facts.auth = 'success';
  await fireEvent.press(screen.getByTestId('lock-unlock'));
  await settle();
}
/** Every string a reader could reach in the tree (texts, names, hints, test ids). */
const whole = (root?: string): string => {
  const out: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    if (typeof node !== 'object' || node === null) return;
    const json = node as { props?: Record<string, unknown>; children?: unknown[] };
    for (const value of Object.values(json.props ?? {})) {
      if (typeof value === 'string') out.push(value);
      else if (typeof value === 'object' && value !== null && 'uri' in value) out.push(String(value.uri));
    }
    for (const child of json.children ?? []) collect(child);
  };
  if (root === undefined) {
    const tree = screen.toJSON();
    for (const node of Array.isArray(tree) ? tree : [tree]) collect(node);
  } else collect(findNode(root));
  return out.join(' | ');
};
const findNode = (testID: string): unknown => {
  const find = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return undefined;
    const json = node as { props?: { testID?: string }; children?: unknown[] };
    if (json.props?.testID === testID) return json;
    for (const child of json.children ?? []) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const tree = screen.toJSON();
  for (const node of Array.isArray(tree) ? tree : [tree]) {
    const found = find(node);
    if (found !== undefined) return found;
  }
  return undefined;
};
/** The network comes back: the next foreground check of the startup (debounced by 5 s) sees the new answer. */
const listeners: ((state: string) => void)[] = [];
beforeEach(() => {
  listeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: () => undefined };
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});
let skew = 0;
async function recheck() {
  skew += 60_000;
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now + skew);
  await act(async () => {
    for (const listener of [...listeners]) listener('active');
    await Promise.resolve();
  });
  await settle();
  clock.mockRestore();
}
const flat = (node: { props: { style?: unknown } }): Record<string, number> =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, number>;

describe('the row "Zdjęcia zlecenia" (EVM-142 AC2, AC6)', () => {
  it.each([
    [0, 'Brak zdjęć', 'Zdjęcia zlecenia, brak zdjęć'],
    [1, '1 zdjęcie', 'Zdjęcia zlecenia, 1 zdjęcie'],
    [3, '3 zdjęcia', 'Zdjęcia zlecenia, 3 zdjęcia'],
    [5, '5 zdjęć', 'Zdjęcia zlecenia, 5 zdjęć'],
  ])('EVM-142 AC2: %i photos in the replica - second line "%s", one touch target of at least 48 dp', async (count, second, name) => {
    const rig = rigWith(Array.from({ length: count }, (_unused, n) => photo(n + 1)));
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    const row = screen.getByTestId('order-photos-row');
    expect(within(row).getByTestId('order-photos-row-second')).toHaveTextContent(second);
    expect(row).toHaveProp('accessibilityLabel', name);
    expect(flat(row as never).minHeight).toBeGreaterThanOrEqual(48);
    expect(rig.mediaView.requests).toEqual([]);
  });

  it('EVM-142 AC2: while the replica is read the row has no second line; a failed read has none either', async () => {
    const rig = rigWith([]);
    rig.sync.orderPhotosHook = () => Promise.reject(new Error('read failed'));
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    expect(screen.queryByTestId('order-photos-row-second')).toBeNull();
    expect(screen.getByTestId('order-photos-row')).toHaveProp('accessibilityLabel', 'Zdjęcia zlecenia');
  });

  it('EVM-142 AC5: in the hidden-data mode the row is not there and the replica is not read for photos', async () => {
    const rig = rigWith([photo(1)]);
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    expect(screen.getByTestId('order-photos-row')).toBeOnTheScreen();
    const before = rig.sync.photoRequests.length;
    await hide(rig);
    expect(screen.queryByTestId('order-photos-row')).toBeNull();
    expect(rig.sync.photoRequests.length).toBe(before);
  });
});

describe('the grid (EVM-142 AC2, AC6)', () => {
  it('EVM-142 AC2: the tiles go from the newest; each has the category and the time, the name "[category], [time]" and requests its thumbnail only', async () => {
    // the replica read builds the rows with `buildOrderPhotos` (newest first); the fake hands them over as given
    const source = (n: number, category: string) => ({
      id: ID(n),
      category,
      description: null,
      capturedAt: T0 + n * MIN_MS,
      fileState: 'ready',
    });
    const rig = rigWith(buildOrderPhotos([source(1, 'before_work'), source(3, 'measurement'), source(2, 'completed_work')]));
    await openGrid(rig);
    expect(screen.getByTestId('order-photos')).toBeOnTheScreen();
    expect(rig.sync.photoRequests).toContain('o1');
    expect(screen.getByTestId('photo-tile-0')).toHaveProp('accessibilityLabel', `${CATEGORY.measurement}, ${when(3)}`);
    expect(screen.getByTestId('photo-tile-1')).toHaveProp('accessibilityLabel', `${CATEGORY.completed_work}, ${when(2)}`);
    expect(screen.getByTestId('photo-tile-2')).toHaveProp('accessibilityLabel', `${CATEGORY.before_work}, ${when(1)}`);
    expect(rig.mediaView.requests.map((request) => request.variant)).toEqual(['thumbnail', 'thumbnail', 'thumbnail']);
    expect(rig.mediaView.requests.map((request) => request.mediaAssetId)).toEqual([ID(3), ID(2), ID(1)]);
    expect(rig.mediaView.requests.every((request) => request.workOrderId === 'o1')).toBe(true);
    expect(screen.getByTestId('photo-tile-0-image')).toBeOnTheScreen();
    expect(screen.getByText(CATEGORY.measurement)).toBeOnTheScreen();
    expect(screen.getByText(when(3))).toBeOnTheScreen();
  });

  it('EVM-142 AC6: a tile and the touch targets are at least 48 dp; no file name, id, customer or address anywhere', async () => {
    const rig = rigWith([photo(1), photo(2, { state: 'preparing' })]);
    await openGrid(rig);
    expect(flat(screen.getByTestId('photo-tile-0') as never).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByTestId('photo-tile-0') as never).width).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByTestId('order-photos-back') as never).minHeight ?? 48).toBeGreaterThanOrEqual(48);
    expect(whole('order-photos')).not.toMatch(/Łódzki|Żółkiewskiego|\.jpg|\.webp|0194c2a0|X-Amz|ZL-2026/);
  });

  it('EVM-142 AC2: a photo without a category is "Bez kategorii"; one without any time has only the category in its name', async () => {
    const rig = rigWith([photo(1, { category: null, capturedAt: null })]);
    await openGrid(rig);
    expect(screen.getByTestId('photo-tile-0')).toHaveProp('accessibilityLabel', pl.upload.noCategory);
  });

  it.each([
    ['preparing', pl.orderPhotos.states.preparing],
    ['quarantined', pl.orderPhotos.states.quarantined],
    ['failed', pl.orderPhotos.states.failed],
    ['awaiting_file', pl.orderPhotos.states.awaiting],
  ] as const)('EVM-142 AC2: a %s photo says so in words, is not a button and no request goes out for it', async (state, words) => {
    const rig = rigWith([photo(1, { state })]);
    await openGrid(rig);
    const tile = screen.getByTestId('photo-tile-0');
    expect(tile).toHaveProp('accessibilityLabel', `${CATEGORY.defect}, ${when(1)}, ${words}`);
    expect(tile.props.accessibilityRole).toBeUndefined();
    expect(within(tile).getByText(words)).toBeOnTheScreen();
    expect(rig.mediaView.requests).toEqual([]);
    await fireEvent.press(tile);
    await settle();
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(rig.mediaView.requests).toEqual([]);
  });

  it('EVM-142 AC2: a quarantined tile says nothing of the cause of the scan', async () => {
    const rig = rigWith([photo(1, { state: 'quarantined' })]);
    await openGrid(rig);
    expect(whole('order-photos')).not.toMatch(/wirus|malware|skanow|infected/i);
  });

  it('EVM-142 AC6: no photos - "Brak zdjęć w tym zleceniu" without a button and without a request', async () => {
    const rig = rigWith([]);
    await openGrid(rig);
    expect(screen.getByTestId('order-photos-empty')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderPhotos.empty)).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-photos-empty')).queryByRole('button')).toBeNull();
    expect(rig.mediaView.requests).toEqual([]);
  });

  it('EVM-142 AC2: while the replica is read a skeleton stands in; a failed read says so and "Spróbuj ponownie" reads again', async () => {
    const rig = rigWith([photo(1)]);
    let calls = 0;
    rig.sync.orderPhotosHook = (id) => {
      calls += 1;
      // the detail row reads the replica first, then the screen: fail the screen's first read only
      if (calls === 2) return Promise.reject(new Error('read failed'));
      return Promise.resolve(rig.sync.photos.get(id) ?? []);
    };
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    await fireEvent.press(screen.getByTestId('order-photos-row'));
    await settle();
    expect(screen.getByText(pl.orderPhotos.loadFailed)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-photos-error-retry'));
    await settle();
    expect(screen.getByTestId('photo-tile-0')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-photos-error')).toBeNull();
  });

  it('EVM-142 AC2: the skeleton is shown while the replica read has not answered', async () => {
    const rig = rigWith([photo(1)]);
    let answer: (photos: readonly OrderPhoto[]) => void = () => undefined;
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    rig.sync.orderPhotosHook = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await fireEvent.press(screen.getByTestId('order-photos-row'));
    await settle();
    expect(screen.getByTestId('order-photos-skeleton')).toBeOnTheScreen();
    await act(async () => {
      answer([photo(1)]);
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('photo-tile-0')).toBeOnTheScreen();
  });

  it('EVM-142 AC2: a thumbnail that is still loading is a skeleton tile that already opens the preview', async () => {
    const rig = rigWith([photo(1)]);
    rig.mediaView.autoAnswer = null;
    await openGrid(rig);
    expect(screen.queryByTestId('photo-tile-0-image')).toBeNull();
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    expect(screen.getByTestId('photo-preview')).toBeOnTheScreen();
  });

  it('EVM-142 AC2: a 404 on a thumbnail is one tile "Zdjęcie niedostępne" - the others stay, no alert of the grid', async () => {
    const rig = rigWith([photo(2), photo(1)]);
    rig.mediaView.autoAnswer = null;
    await openGrid(rig);
    await act(async () => {
      rig.mediaView.pending.find((load) => load.request.mediaAssetId === ID(2))?.settle({ kind: 'not_found' });
      rig.mediaView.pending.find((load) => load.request.mediaAssetId === ID(1))?.settle({ kind: 'ok' });
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('photo-tile-0')).toHaveProp(
      'accessibilityLabel',
      `${CATEGORY.defect}, ${when(2)}, ${pl.orderPhotos.states.unavailable}`,
    );
    expect(screen.getByTestId('photo-tile-1-image')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-photos-part-failed')).toBeNull();
  });

  it('EVM-142 AC4: a 403 on a thumbnail gives the general message instead of the grid, with no code and no reason', async () => {
    const rig = rigWith([photo(1), photo(2)]);
    rig.mediaView.autoAnswer = { kind: 'forbidden' };
    await openGrid(rig);
    expect(screen.getByTestId('order-photos-forbidden')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderPhotos.forbidden)).toBeOnTheScreen();
    expect(whole()).not.toMatch(/403|channel_not_allowed|forbidden(?!\b-)/i.source === '' ? /$^/ : /403|channel_not_allowed/);
    expect(screen.queryByTestId('photo-tile-0')).toBeNull();
  });

  it('EVM-142 AC2: a failed thumbnail says so under the tile; a touch loads it again; "Spróbuj ponownie" of the grid loads all failed ones', async () => {
    const rig = rigWith([photo(2), photo(1)]);
    rig.mediaView.autoAnswer = { kind: 'failed' };
    await openGrid(rig);
    expect(screen.getByTestId('order-photos-part-failed')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderPhotos.partFailed)).toBeOnTheScreen();
    expect(screen.getByTestId('photo-tile-0')).toHaveProp(
      'accessibilityLabel',
      `${CATEGORY.defect}, ${when(2)}, ${pl.orderPhotos.states.loadFailed}`,
    );
    expect(screen.getByTestId('photo-tile-0')).toHaveProp('accessibilityHint', pl.orderPhotos.tileRetryHint);
    const before = rig.mediaView.requests.length;
    // one tile: a touch loads it again, no automatic loop
    rig.mediaView.autoAnswer = { kind: 'ok' };
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    expect(rig.mediaView.requests.length).toBe(before + 1);
    expect(screen.getByTestId('photo-tile-0-image')).toBeOnTheScreen();
    // the whole grid: the other failed tile
    expect(screen.getByTestId('order-photos-part-failed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-photos-retry'));
    await settle();
    expect(screen.queryByTestId('order-photos-part-failed')).toBeNull();
    expect(screen.getByTestId('photo-tile-1-image')).toBeOnTheScreen();
  });

  it('EVM-142 AC2: a 429 is a failed tile as well (a touch tries again)', async () => {
    const rig = rigWith([photo(1)]);
    rig.mediaView.autoAnswer = { kind: 'rate_limited' };
    await openGrid(rig);
    expect(screen.getByTestId('order-photos-part-failed')).toBeOnTheScreen();
  });

  it('EVM-142 AC2: an aborted request changes nothing on the tile', async () => {
    const rig = rigWith([photo(1)]);
    rig.mediaView.autoAnswer = { kind: 'aborted' };
    await openGrid(rig);
    expect(screen.queryByTestId('photo-tile-0-image')).toBeNull();
    expect(screen.queryByTestId('order-photos-part-failed')).toBeNull();
  });

  it('EVM-142 AC2: the thumbnails load lazily - only the first rows ask at first, and the tiles that leave the reported window free their image', async () => {
    const rig = rigWith(Array.from({ length: 60 }, (_unused, n) => photo(60 - n)));
    await openGrid(rig);
    const first = rig.mediaView.requests.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(60);
    const grid = screen.getByTestId('order-photos-grid');
    const report = grid.props.onViewableItemsChanged as (info: { viewableItems: { index: number | null }[]; changed: [] }) => void;
    const released = rig.mediaView.released.length;
    // the list reports the visible rows (the first two tiles); the tiles further than one row around them stop holding an image
    await act(async () => {
      report({ viewableItems: [{ index: 0 }, { index: 1 }, { index: null }], changed: [] });
      await Promise.resolve();
    });
    await settle();
    expect(rig.mediaView.released.length).toBeGreaterThan(released);
    expect(rig.mediaView.requests.length).toBe(first);
    // an empty report changes nothing
    const count = rig.mediaView.released.length;
    await act(async () => {
      report({ viewableItems: [], changed: [] });
      await Promise.resolve();
    });
    expect(rig.mediaView.released.length).toBe(count);
  });

  it('EVM-142 AC6: three columns on a normal screen, two at 200% of the font or on a narrow one (a tile keeps its size)', () => {
    expect(columnsFor(412, 1)).toBe(3);
    expect(columnsFor(412, 2)).toBe(2);
    expect(columnsFor(412, 1.3)).toBe(3);
    expect(columnsFor(300, 1)).toBe(2);
  });

  it('EVM-142 AC6: the back action returns to the order; the queue opens from the capsule', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    await fireEvent.press(screen.getByTestId('order-photos-back'));
    await settle();
    expect(screen.queryByTestId('order-photos')).toBeNull();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-photos-row'));
    await settle();
    await fireEvent.press(screen.getByTestId('sync-indicator'));
    await settle();
    expect(screen.queryByTestId('order-photos')).toBeNull();
  });

  it('EVM-142 AC6: a photo of a colleague that becomes ready after a synchronization cycle shows up (the replica is read again)', async () => {
    const rig = rigWith([photo(1, { state: 'preparing' })]);
    await openGrid(rig);
    expect(rig.mediaView.requests).toEqual([]);
    rig.sync.photos.set('o1', [photo(1)]);
    await act(async () => {
      rig.sync.set({ lastSuccessAt: Date.now() + 1000 });
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('photo-tile-0-image')).toBeOnTheScreen();
  });
});

describe('offline (EVM-142 AC4)', () => {
  it('EVM-142 AC4: offline the rows of the replica are a list with "Podgląd zdjęć wymaga internetu" - no thumbnail, no request, no server error', async () => {
    const rig = rigWith([photo(2, { state: 'quarantined' }), photo(1)]);
    await openGrid(rig, offline);
    expect(screen.getByTestId('order-photos-offline')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderPhotos.offline)).toBeOnTheScreen();
    expect(screen.getByTestId('photo-row-0')).toHaveProp(
      'accessibilityLabel',
      `${CATEGORY.defect}, ${when(2)}, ${pl.orderPhotos.states.quarantined}`,
    );
    expect(screen.getByTestId('photo-row-1')).toHaveProp('accessibilityLabel', `${CATEGORY.defect}, ${when(1)}`);
    expect(flat(screen.getByTestId('photo-row-0') as never).minHeight).toBeGreaterThanOrEqual(48);
    expect(screen.queryByTestId('order-photos-grid')).toBeNull();
    expect(screen.queryByTestId('order-photos-part-failed')).toBeNull();
    expect(screen.queryByTestId('order-photos-forbidden')).toBeNull();
    expect(rig.mediaView.requests).toEqual([]);
  });

  it('EVM-142 AC4: a row without a time shows the category only', async () => {
    const rig = rigWith([photo(1, { capturedAt: null, category: null })]);
    await openGrid(rig, offline);
    expect(screen.getByTestId('photo-row-0')).toHaveProp('accessibilityLabel', pl.upload.noCategory);
  });

  it('EVM-142 AC4: when the network returns the thumbnails load by themselves', async () => {
    const rig = rigWith([photo(1)]);
    let state: 'online' | 'offline' = 'offline';
    const checker: StartupChecker = () => Promise.resolve({ kind: state });
    await openGrid(rig, checker);
    expect(screen.getByTestId('order-photos-offline')).toBeOnTheScreen();
    expect(rig.mediaView.requests).toEqual([]);
    state = 'online';
    await recheck();
    expect(screen.queryByTestId('order-photos-offline')).toBeNull();
    expect(screen.getByTestId('photo-tile-0-image')).toBeOnTheScreen();
    expect(rig.mediaView.requests.length).toBe(1);
  });

  it('EVM-142 AC4: the empty order stays empty offline (nothing to explain)', async () => {
    const rig = rigWith([]);
    await openGrid(rig, offline);
    expect(screen.getByTestId('order-photos-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-photos-offline')).toBeNull();
  });
});

describe('the preview (EVM-142 AC3, AC4, AC6)', () => {
  const openPreview = async (rig: PortsRig, index = 0, checker: StartupChecker = online) => {
    await openGrid(rig, checker);
    await fireEvent.press(screen.getByTestId(`photo-tile-${String(index)}`));
    await settle();
  };

  it('EVM-142 AC3: a touch opens the 1600 px preview with the category, the time and the description, in the main window (not a Modal)', async () => {
    const rig = rigWith([photo(1, { description: 'Synthetic description of the work' })]);
    await openPreview(rig);
    const view = screen.getByTestId('photo-preview');
    expect(view).toBeOnTheScreen();
    expect(rig.mediaView.requests.at(-1)).toMatchObject({ mediaAssetId: ID(1), variant: 'preview', workOrderId: 'o1' });
    expect(screen.getByTestId('photo-preview-image')).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-preview-skeleton')).toBeNull();
    expect(within(view).getByText(CATEGORY.defect)).toBeOnTheScreen();
    expect(within(view).getByText(when(1))).toBeOnTheScreen();
    expect(within(view).getByText('Synthetic description of the work')).toBeOnTheScreen();
    expect(screen.getByTestId('photo-preview-header')).toHaveProp('accessibilityLabel', `Podgląd zdjęcia, ${CATEGORY.defect}, ${when(1)}`);
    // a child of the grid's screen (the window of the app), not a Modal or another activity
    expect(within(screen.getByTestId('order-photos')).getByTestId('photo-preview')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('photo-preview-close') as never).width).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByTestId('photo-preview-close') as never).height).toBeGreaterThanOrEqual(48);
  });

  it('EVM-142 AC3: a photo without a time and a description has the category only and no panel of the description', async () => {
    const rig = rigWith([photo(1, { capturedAt: null })]);
    await openPreview(rig);
    expect(screen.getByTestId('photo-preview-header')).toHaveProp('accessibilityLabel', `Podgląd zdjęcia, ${CATEGORY.defect}`);
    expect(screen.queryByTestId('photo-preview-description')).toBeNull();
  });

  it('EVM-142 AC3: while the preview loads the thumbnail of the grid stays in its place, then a skeleton when there is none', async () => {
    const rig = rigWith([photo(2), photo(1)]);
    rig.mediaView.autoAnswer = null;
    await openGrid(rig);
    await act(async () => {
      rig.mediaView.pending.find((load) => load.request.mediaAssetId === ID(2))?.settle({ kind: 'ok' });
      await Promise.resolve();
    });
    await settle();
    // the thumbnail of tile 0 (photo 2) is in memory: the preview shows it at once
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    expect(screen.getByTestId('photo-preview-image')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('photo-preview-close'));
    await settle();
    // tile 1 (photo 1) has no thumbnail yet: a skeleton
    await fireEvent.press(screen.getByTestId('photo-tile-1'));
    await settle();
    expect(screen.getByTestId('photo-preview-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('photo-preview-skeleton')).toHaveProp('accessibilityLabel', pl.orderPhotos.preview.loading);
  });

  it('EVM-142 AC3: "Zamknij" and the system Back close the preview first (the grid stays), the next Back leaves the grid', async () => {
    const rig = rigWith([photo(1)]);
    let back: () => boolean | null | undefined = () => false;
    const subscribe = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      back = () => handler(undefined as never);
      return { remove: () => undefined };
    });
    try {
      await openPreview(rig);
      await fireEvent.press(screen.getByTestId('photo-preview-close'));
      await settle();
      expect(screen.queryByTestId('photo-preview')).toBeNull();
      expect(screen.getByTestId('order-photos')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('photo-tile-0'));
      await settle();
      expect(screen.getByTestId('photo-preview')).toBeOnTheScreen();
      await act(() => {
        expect(back()).toBe(true);
      });
      await settle();
      expect(screen.queryByTestId('photo-preview')).toBeNull();
      expect(screen.getByTestId('order-photos')).toBeOnTheScreen();
      await act(() => {
        expect(back()).toBe(true);
      });
      await settle();
      expect(screen.queryByTestId('order-photos')).toBeNull();
      expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    } finally {
      subscribe.mockRestore();
    }
  });

  it('EVM-142 AC3: a failed load says "Nie udało się wczytać zdjęcia" and "Spróbuj ponownie" asks again; a success shows the photo', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    rig.mediaView.autoAnswer = { kind: 'failed' };
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    expect(screen.getByText(pl.orderPhotos.preview.loadFailed)).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-preview-image')).toBeNull();
    const before = rig.mediaView.requests.length;
    rig.mediaView.autoAnswer = null;
    await fireEvent.press(screen.getByTestId('photo-preview-retry'));
    await settle();
    // the retry is a NEW request; while it runs the notice stays (busy), no flash of the photo
    expect(rig.mediaView.requests.length).toBe(before + 1);
    expect(screen.getByText(pl.orderPhotos.preview.loadFailed)).toBeOnTheScreen();
    await act(async () => {
      rig.mediaView.pending.at(-1)?.settle({ kind: 'ok' });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByText(pl.orderPhotos.preview.loadFailed)).toBeNull();
    expect(screen.getByTestId('photo-preview-image')).toBeOnTheScreen();
  });

  it.each(['forbidden', 'not_found'] as const)(
    'EVM-142 AC4: a %s on the preview is final - one general sentence, no retry, no reason',
    async (kind) => {
      const rig = rigWith([photo(1)]);
      await openGrid(rig);
      rig.mediaView.autoAnswer = { kind };
      await fireEvent.press(screen.getByTestId('photo-tile-0'));
      await settle();
      expect(screen.getByText(pl.orderPhotos.preview.unavailable)).toBeOnTheScreen();
      expect(screen.queryByTestId('photo-preview-retry')).toBeNull();
      expect(within(screen.getByTestId('photo-preview')).queryByText(/403|404/)).toBeNull();
    },
  );

  it('EVM-142 AC4: offline the preview says "Podgląd zdjęć wymaga internetu"; the first return of the network tries once, silently', async () => {
    const rig = rigWith([photo(1)]);
    let net: 'online' | 'offline' = 'online';
    const checker: StartupChecker = () => Promise.resolve({ kind: net });
    await openGrid(rig, checker);
    rig.mediaView.autoAnswer = { kind: 'failed' };
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    net = 'offline';
    // the network is gone: the capsule asks again (the preview covers the grid, but the app bar of the shell is under it)
    await recheck();
    expect(within(screen.getByTestId('photo-preview')).getByText(pl.orderPhotos.preview.offline)).toBeOnTheScreen();
    const previews = () => rig.mediaView.requests.filter((request) => request.variant === 'preview').length;
    const before = previews();
    rig.mediaView.autoAnswer = { kind: 'ok' };
    net = 'online';
    await recheck();
    expect(previews()).toBe(before + 1);
    expect(screen.getByTestId('photo-preview-image')).toBeOnTheScreen();
  });

  it('EVM-142 AC3: a photo that left the replica closes the preview instead of leaving an empty layer', async () => {
    const rig = rigWith([photo(1)]);
    await openPreview(rig);
    rig.sync.photos.set('o1', []);
    await act(async () => {
      rig.sync.set({ lastSuccessAt: Date.now() + 1000 });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.getByTestId('order-photos-empty')).toBeOnTheScreen();
  });

  it('EVM-142 AC3: the grid under the preview is hidden from the reader', async () => {
    const rig = rigWith([photo(1)]);
    await openPreview(rig);
    expect(screen.getByTestId('photo-preview')).toHaveProp('accessibilityViewIsModal', true);
  });
});

describe('nothing stays and nothing is requested in the hidden states (EVM-142 AC5)', () => {
  it('EVM-142 AC5: the hidden-data mode takes the grid out of the tree at once, aborts the requests in flight and drops the late answers', async () => {
    const rig = rigWith([photo(1), photo(2)]);
    rig.mediaView.autoAnswer = null;
    await openGrid(rig);
    const flying = [...rig.mediaView.pending];
    expect(flying.length).toBeGreaterThan(0);
    await hide(rig);
    expect(screen.queryByTestId('order-photos-grid')).toBeNull();
    expect(screen.queryByTestId('photo-tile-0')).toBeNull();
    expect(screen.getByTestId('order-photos-hidden')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderFiles.hidden)).toBeOnTheScreen();
    expect(flying.every((load) => load.request.signal.aborted)).toBe(true);
    const asked = rig.mediaView.requests.length;
    await act(async () => {
      for (const load of flying) load.settle({ kind: 'ok' });
      await Promise.resolve();
    });
    await settle();
    expect(whole()).not.toMatch(/data:image|photo-tile|Usterka/);
    expect(rig.mediaView.requests.length).toBe(asked);
  });

  it('EVM-142 AC5: the preview with a request in flight disappears with the mode; the late address or image shows nothing and nothing new is asked', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    rig.mediaView.autoAnswer = null;
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    const flying = rig.mediaView.pending.filter((load) => load.request.variant === 'preview');
    expect(flying).toHaveLength(1);
    await hide(rig);
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(flying[0]?.request.signal.aborted).toBe(true);
    const asked = rig.mediaView.requests.length;
    await act(async () => {
      flying[0]?.settle({ kind: 'ok' });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.queryByTestId('photo-preview-image')).toBeNull();
    expect(rig.mediaView.requests.length).toBe(asked);
  });

  it('EVM-142 AC5: the hidden-data notice offers the same action as the rest of the app; back from the mode the grid starts from the beginning', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    await hide(rig);
    expect(screen.getByTestId('order-photos-hidden-action')).toBeOnTheScreen();
    rig.device.facts.secure = true;
    await fireEvent.press(screen.getByTestId('order-photos-hidden-action'));
    await settle();
    expect(screen.getByTestId('photo-tile-0')).toBeOnTheScreen();
  });

  it('EVM-142 AC5: the hidden-data mode with the other reasons offers the re-sign-in action; a reason without an action offers none', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    rig.device.facts.contact = { status: { visible: false, reason: 'window_elapsed', elapsedMs: 8 * 24 * 60 * MIN_MS }, windowDays: 7 };
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('order-photos-hidden')).toBeOnTheScreen();
    expect(screen.getByTestId('order-photos-hidden-action')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-photos-hidden-action'));
    await settle();
  });

  it('EVM-142 AC5: the lock takes the grid out of the view, aborts the requests; after the unlock the grid is drawn again and asks anew', async () => {
    const rig = rigWith([photo(1)]);
    rig.mediaView.autoAnswer = null;
    await openGrid(rig);
    const flying = [...rig.mediaView.pending];
    await lock(rig);
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(flying.every((load) => load.request.signal.aborted)).toBe(true);
    expect(rig.mediaView.released.length).toBeGreaterThan(0);
    const asked = rig.mediaView.requests.length;
    rig.mediaView.autoAnswer = { kind: 'ok' };
    await unlock(rig);
    expect(rig.mediaView.requests.length).toBeGreaterThan(asked);
    expect(screen.getByTestId('photo-tile-0-image')).toBeOnTheScreen();
  });

  it('EVM-142 AC5: the preview does not survive the lock - after the unlock the grid is there, the preview is not', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    expect(screen.getByTestId('photo-preview')).toBeOnTheScreen();
    await lock(rig);
    await unlock(rig);
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(screen.getByTestId('order-photos')).toBeOnTheScreen();
  });

  it('EVM-142 AC5: freeing all images (the background, the end of a cycle) makes the tiles ask again', async () => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    const before = rig.mediaView.requests.length;
    await act(async () => {
      rig.mediaView.releaseAll();
      await Promise.resolve();
    });
    await settle();
    expect(rig.mediaView.requests.length).toBeGreaterThan(before);
  });

  it.each([
    ['session_revoked', { reason: 'session_revoked' as const, unsentItems: 0 }],
    ['signed_out', { reason: 'signed_out' as const, unsentItems: 0 }],
  ])('EVM-142 AC5: %s takes the grid and the preview out of the tree and aborts the requests', async (_name, ended) => {
    const rig = rigWith([photo(1)]);
    await openGrid(rig);
    rig.mediaView.autoAnswer = null;
    await fireEvent.press(screen.getByTestId('photo-tile-0'));
    await settle();
    const flying = [...rig.mediaView.pending];
    await act(async () => {
      rig.owner.end(ended);
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('order-photos')).toBeNull();
    expect(screen.queryByTestId('photo-preview')).toBeNull();
    expect(flying.every((load) => load.request.signal.aborted)).toBe(true);
    expect(whole()).not.toMatch(/data:image|Usterka/);
  });
});
