// "Pliki zlecenia" and the row "Pliki z tego telefonu" (EVM-111 AC1-AC6): the files of THIS phone that belong to the open order and have not been confirmed
// by the server - over the same snapshot as "Kolejka"; the entry of a confirmed file is removed by the queue (EVM-111 AC5; test/upload/media-uploads.test.ts).
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { App } from '../../src/App';
import { pl } from '../../src/i18n/pl';
import { formatDateTime } from '../../src/i18n/format';
import type { OrderDetail } from '../../src/orders/order-detail-model';
import { buildOrderList, type OrderListSource } from '../../src/orders/order-list-model';
import type { StartupChecker } from '../../src/startup';
import type { MediaFileView, MediaUploadsSnapshot } from '../../src/upload/types';
import { MIN } from '../device-guard/fakes';
import { stubOwner, stubPorts, type PortsRig } from '../session-helpers';

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

const settle = () =>
  act(async () => {
    for (let n = 0; n < 12; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });
const AT = Date.UTC(2026, 10, 18, 9, 30);
const ID = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ORDER = 'o1';

const SOURCE: OrderListSource = {
  orders: [{ id: ORDER, number: 'ZL-2026-0042', status: 'in_progress', createdAt: AT, customerId: 'c1', siteId: 's1' }],
  customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
  sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
  stages: [],
};
const DETAIL: OrderDetail = {
  id: ORDER,
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { name: 'Jan Łódzki Synthetic', phone: '+48 600 100 200', dial: '+48600100200' },
  location: { street: 'ul. Żółkiewskiego 7', city: '00-001 Łódź', spot: '15', level: '-1', powerKw: null, operator: null, manager: null },
  scope: [],
  processes: [],
  journal: [],
};
/** What the files screen must never show: the customer, the address, the number of the order, a name of a file or a path. */
const SECRETS = /Łódzki|Żółkiewskiego|Łódź|ZL-2026-0042|600 100 200|Garaż|secret-key|\/data\/user|\.jpg|\.mp4/;

const file = (n: number, patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId: ID(n),
  workOrderId: ORDER,
  status: 'waiting',
  percent: null,
  sizeBytes: 2_000_000,
  actions: [],
  code: null,
  updatedAt: AT,
  category: 'defect',
  mediaType: 'photo',
  capturedAt: AT + n * 1000,
  ...patch,
});
const snap = (files: MediaFileView[], extra: Partial<MediaUploadsSnapshot> = {}): MediaUploadsSnapshot => ({
  files,
  notifications: 'granted',
  confirmed: 0,
  read: 'ready',
  ...extra,
});

const rigWith = (files: MediaFileView[] = [], extra: Partial<MediaUploadsSnapshot> = {}): PortsRig => {
  const rig = stubPorts();
  rig.sync.rows = buildOrderList(SOURCE, []);
  rig.sync.details.set(ORDER, DETAIL);
  rig.media.set(snap(files, extra));
  return rig;
};
async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const openDetail = async (rig: PortsRig, checker: StartupChecker = online) => {
  await open(rig, checker);
  await fireEvent.press(screen.getByTestId(`order-row-${ORDER}`));
  await settle();
};
const openFiles = async (rig: PortsRig, checker: StartupChecker = online) => {
  await openDetail(rig, checker);
  await fireEvent.press(screen.getByTestId('order-files-row'));
  await settle();
};
const hide = async (rig: PortsRig) => {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};
/** Every string a reader or a tool could reach in the rendered tree - texts, names, hints, ids - hidden elements too (the props of components are not the screen). */
const whole = (): string => {
  const out: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    if (typeof node !== 'object' || node === null) return;
    const json = node as { props?: Record<string, unknown>; children?: unknown[] };
    for (const key of ['accessibilityLabel', 'accessibilityHint', 'testID', 'value', 'placeholder'] as const) {
      const value = json.props?.[key];
      if (typeof value === 'string') out.push(value);
    }
    for (const child of json.children ?? []) collect(child);
  };
  collect(screen.toJSON());
  return out.join(' | ');
};
const flat = (node: { props: { style?: unknown } }): Record<string, number> =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, number>;

/** The calls the screens made to the files of the queue (the shell reads the target of a notification by itself - not counted). */
const calls = (rig: PortsRig): string[] => rig.media.calls.filter((call) => call !== 'consumeLaunchTarget');

let announce: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  announce.mockRestore();
  jest.useRealTimers();
});

describe('the row "Pliki z tego telefonu" in the details of the order (EVM-111 AC1, AC2)', () => {
  it('EVM-111 AC1: a fixed row above the journal - one touch target with a chevron, its second line is "n do wysłania" and its name carries the same number', async () => {
    await openDetail(rigWith([file(1), file(2, { status: 'uploading', percent: 30 }), file(3, { workOrderId: 'other' })]));
    const row = screen.getByTestId('order-files-row');
    expect(row).toHaveAccessibilityValue({});
    expect(row).toHaveProp('accessibilityRole', 'button');
    expect(row).toHaveProp('accessibilityLabel', 'Pliki z tego telefonu, 2 do wysłania');
    expect(row).toHaveProp('accessibilityHint', 'Otwiera listę plików zlecenia');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(48);
    expect(within(row).getByText('Pliki z tego telefonu')).toBeOnTheScreen();
    expect(screen.getByTestId('order-files-row-second')).toHaveTextContent('2 do wysłania', { exact: true });
    // above the journal, below the header of the order
    const ids = ['order-detail-location', 'order-files-row', 'order-detail-journal-heading'];
    const order = ids.map((id) => whole().indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
  });

  it('EVM-111 AC2: with nothing to send the row says "Wszystko wysłane" (a check, the name says "wszystko wysłane")', async () => {
    await openDetail(rigWith([file(9, { workOrderId: 'other' })]));
    expect(screen.getByTestId('order-files-row')).toHaveProp('accessibilityLabel', 'Pliki z tego telefonu, wszystko wysłane');
    expect(screen.getByTestId('order-files-row-second')).toHaveTextContent('Wszystko wysłane', { exact: true });
  });

  it('EVM-111 AC2: the number follows the queue without any refresh, in every state (waiting, sending, Wi-Fi, error, attention) - the row speaks only through its name', async () => {
    const rig = rigWith([file(1)]);
    await openDetail(rig);
    await act(() => {
      rig.media.set(
        snap([
          file(1, { status: 'waiting_wifi', mediaType: 'video', durationMs: 4000 }),
          file(2, { status: 'error', actions: ['retry'], code: 'checksum_mismatch' }),
          file(3, { status: 'attention', code: 'quarantined', actions: ['discard'] }),
        ]),
      );
    });
    expect(screen.getByTestId('order-files-row')).toHaveProp('accessibilityLabel', 'Pliki z tego telefonu, 3 do wysłania');
    expect(screen.getByTestId('order-files-row-second')).toHaveTextContent('3 do wysłania', { exact: true });
    await act(() => {
      rig.media.set(snap([], { confirmed: 3 }));
    });
    expect(screen.getByTestId('order-files-row')).toHaveProp('accessibilityLabel', 'Pliki z tego telefonu, wszystko wysłane');
    // no announcement of its own: the screen "Pliki zlecenia" speaks, the row is silent
    expect(announce).not.toHaveBeenCalled();
  });

  it('EVM-111 AC3: while the table is read, or when its read failed, the row has no second line and the name is the title alone', async () => {
    for (const read of ['loading', 'failed'] as const) {
      const rig = rigWith([], { read });
      await openDetail(rig);
      expect(screen.getByTestId('order-files-row')).toHaveProp('accessibilityLabel', 'Pliki z tego telefonu');
      expect(screen.queryByTestId('order-files-row-second')).toBeNull();
      await screen.unmount();
    }
  });
});

describe('"Pliki zlecenia" - the list (EVM-111 AC1)', () => {
  it('EVM-111 AC2: a file after the transfer, before the confirmation, is "Wysyła się 100%" (in progress, counted as to send, above the waiting ones) - never "Oczekuje"', async () => {
    const rig = rigWith([file(1), file(2, { status: 'uploading', percent: 100, awaitsConfirmation: true })]);
    await openFiles(rig);
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('2 do wysłania', { exact: true });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).toHaveTextContent('Wysyła się 100%', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).not.toHaveTextContent('Oczekuje', { exact: false });
    const shown = screen.getAllByTestId(/^order-file-[0-9a-f-]+$/).map((node) => String(node.props.testID).slice('order-file-'.length));
    expect(shown).toEqual([2, 1].map(ID));
  });

  it('EVM-111 AC1: a flat list of the files of THIS order only - the order Wymaga uwagi, Nie wysłano, w toku, oczekujące (newest first inside a group); no file of another order', async () => {
    const rig = rigWith([
      file(1),
      file(2, { status: 'waiting_wifi', mediaType: 'video', durationMs: 133_400, sizeBytes: 78 * 1024 * 1024 }),
      file(3, { status: 'uploading', percent: 45 }),
      file(4, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }),
      file(5, { status: 'attention', code: 'id_conflict', actions: ['retry', 'discard'] }),
      file(6, { workOrderId: 'other-order' }),
      file(7),
    ]);
    await openFiles(rig);
    expect(screen.getByTestId('order-files')).toBeOnTheScreen();
    expect(screen.getByText(pl.orderFiles.title)).toBeOnTheScreen();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('6 do wysłania', { exact: true });
    const shown = screen.getAllByTestId(/^order-file-[0-9a-f-]+$/).map((node) => String(node.props.testID).slice('order-file-'.length));
    // attention (5), error (4), uploading (3), then waiting - the film waiting for Wi-Fi among them - newest first: 7, 2, 1
    expect(shown).toEqual([5, 4, 3, 7, 2, 1].map(ID));
    expect(screen.queryByTestId(`order-file-${ID(6)}`)).toBeNull();
    // one label of the state each; the film keeps its length and size; "Czeka na Wi-Fi" without a banner and without an explanation
    expect(screen.getByTestId(`order-file-${ID(5)}`)).toHaveTextContent('Wymaga uwagi', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(4)}`)).toHaveTextContent('Nie wysłano', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(3)}`)).toHaveTextContent('Wysyła się 45%', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toHaveTextContent('Oczekuje', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).toHaveTextContent('Czeka na Wi-Fi', { exact: false });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).toHaveTextContent('Film · 2:13 · 78 MB', { exact: false });
    expect(screen.queryByTestId('waiting-wifi-banner')).toBeNull();
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toHaveTextContent(formatDateTime(AT + 1000), { exact: false });
    // no customer, no address, no name of a file or a path; nothing "Wysłano"
    expect(within(screen.getByTestId('order-files')).queryByText(SECRETS)).toBeNull();
    expect(screen.queryByText('Wysłano')).toBeNull();
  });

  it('EVM-111 AC1: no file of another phone or of the panel - the list comes from the snapshot of this phone alone (no request of any kind is made)', async () => {
    const rig = rigWith([file(1)]);
    await openFiles(rig);
    expect(calls(rig)).toEqual([]);
    expect(rig.sync.calls.filter((call) => call.startsWith('enqueue') || call === 'trigger')).toEqual([]);
  });

  it('EVM-111 AC6: the row of a file is ONE spoken group "[kategoria], [typ], [czas], [stan]" and its buttons are outside it', async () => {
    const rig = rigWith([
      file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] }),
      file(2, { status: 'error', actions: ['retry'] }),
    ]);
    await openFiles(rig);
    const group = screen.getByTestId(`order-file-${ID(1)}-info`);
    expect(group).toHaveProp('accessibilityLabel', `Usterka / problem, Zdjęcie, ${formatDateTime(AT + 1000)}, Wymaga uwagi`);
    expect(within(group).queryByRole('button')).toBeNull();
    expect(screen.getByTestId(`order-file-${ID(1)}-discard`)).toBeOnTheScreen();
    expect(screen.getByTestId(`order-file-${ID(2)}-retry`)).toBeOnTheScreen();
    expect(flat(screen.getByTestId(`order-file-${ID(2)}`)).minHeight).toBeGreaterThanOrEqual(48);
  });
});

describe('"Pliki zlecenia" - the header and the announcements (EVM-111 AC2)', () => {
  it('EVM-111 AC2: the header shows the same number as the row; "Wszystko wysłane" at zero and ONCE for the reader, after the server confirmed the last file', async () => {
    const rig = rigWith([file(1), file(2)]);
    await openFiles(rig);
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('2 do wysłania', { exact: true });
    expect(screen.getByRole('header', { name: '2 do wysłania' })).toBeOnTheScreen();
    expect(screen.getByTestId('order-files-row', { includeHiddenElements: true })).toHaveProp(
      'accessibilityLabel',
      'Pliki z tego telefonu, 2 do wysłania',
    );
    await act(() => {
      rig.media.set(snap([], { confirmed: 2 }));
    });
    await settle();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('Wszystko wysłane', { exact: true });
    expect(screen.getByTestId('order-files-row', { includeHiddenElements: true })).toHaveProp(
      'accessibilityLabel',
      'Pliki z tego telefonu, wszystko wysłane',
    );
    expect(announce.mock.calls.filter(([said]) => said === 'Wszystko wysłane.')).toHaveLength(1);
    // another change of the snapshot with nothing to send says nothing more
    await act(() => {
      rig.media.set(snap([], { confirmed: 2, notifications: 'denied' }));
    });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('EVM-111 AC2: a list emptied by "Usuń z telefonu" (nothing was confirmed) is not announced as "Wszystko wysłane"', async () => {
    const rig = rigWith([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] })]);
    await openFiles(rig);
    await act(() => {
      rig.media.set(snap([]));
    });
    await settle();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('Wszystko wysłane', { exact: true });
    expect(announce).not.toHaveBeenCalled();
  });

  it('EVM-111 AC2: a change of the number is announced together - one sentence after a moment of quiet, never at every change and never for a percentage', async () => {
    const rig = rigWith([file(1), file(2), file(3, { status: 'uploading', percent: 10 }), file(4)]);
    await openFiles(rig);
    jest.useFakeTimers();
    await act(() => {
      rig.media.set(snap([file(1), file(2), file(3, { status: 'uploading', percent: 40 }), file(4)]));
    });
    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(announce).not.toHaveBeenCalled();
    await act(() => {
      rig.media.set(snap([file(1), file(2), file(3, { status: 'uploading', percent: 60 })], { confirmed: 1 }));
    });
    await act(() => {
      jest.advanceTimersByTime(400);
    });
    await act(() => {
      rig.media.set(snap([file(1), file(2)], { confirmed: 2 }));
    });
    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(announce.mock.calls).toEqual([['2 do wysłania']]);
  });
});

describe('"Pliki zlecenia" - empty, loading, failed read, offline (EVM-111 AC3)', () => {
  it('EVM-111 AC3, EVM-142 AC6: nothing to send - the sentence leads to the row "Zdjęcia zlecenia" (no longer to the panel) and no button; the header says "Wszystko wysłane"; "Zrób zdjęcie" is only in the bar of the order', async () => {
    await openFiles(rigWith([file(1, { workOrderId: 'other-order' })]));
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('Wszystko wysłane', { exact: true });
    const empty = screen.getByTestId('order-files-empty');
    expect(
      within(empty).getByText('Wszystko wysłane. Zdjęcia zlecenia znajdziesz w wierszu „Zdjęcia zlecenia”. Filmy ogląda biuro w panelu.'),
    ).toBeOnTheScreen();
    expect(within(empty).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('order-files')).queryByText(pl.orderDetail.takePhoto)).toBeNull();
  });

  it('EVM-111 AC3: while the table is read there is a skeleton named "Wczytywanie plików…" - no spinner, no count, no rows', async () => {
    await openFiles(rigWith([file(1)], { read: 'loading' }));
    expect(screen.getByTestId('order-files-skeleton')).toBeOnTheScreen();
    expect(screen.getByLabelText('Wczytywanie plików…')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-count')).toBeNull();
    expect(screen.queryByTestId(`order-file-${ID(1)}`)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('EVM-111 AC3: a failed read says so with "Spróbuj ponownie" - the button only reads again (nothing is changed), and the list returns', async () => {
    const rig = rigWith([file(1)], { read: 'failed' });
    await openFiles(rig);
    expect(screen.getByTestId('order-files-error')).toBeOnTheScreen();
    expect(screen.getByText('Nie udało się wczytać listy plików.')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-count')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(calls(rig)).toEqual(['reload']);
    await act(() => {
      rig.media.set(snap([file(1)]));
    });
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-error')).toBeNull();
  });

  it('EVM-111 AC3: offline the files and their states are the same - no error and no banner of the connection (the capsule of the bar is the only sign)', async () => {
    const rig = rigWith([file(1), file(2, { status: 'uploading', percent: 20 })]);
    await openFiles(rig, offline);
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('2 do wysłania', { exact: true });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).toHaveTextContent('Wysyła się 20%', { exact: false });
    expect(within(screen.getByTestId('order-files')).queryByText(/Brak zasięgu/)).toBeNull();
    expect(screen.queryByTestId('order-files-error')).toBeNull();
  });
});

describe('"Pliki zlecenia" - reasons and actions (EVM-111 AC4)', () => {
  it('EVM-111 AC4: under the label there is a reason in plain words from the closed dictionary, with the actions of the Queue: "Ponów" where a retry makes sense, "Usuń z telefonu" where it does not', async () => {
    const rig = rigWith([
      file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] }),
      file(2, { status: 'attention', code: 'id_conflict', actions: ['retry', 'discard'] }),
      file(3, { status: 'attention', code: 'missing_original', actions: ['retry', 'discard'] }),
      file(4, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }),
      file(5, { status: 'uploading', percent: 5 }),
      file(6, { status: 'waiting_wifi', mediaType: 'video' }),
      file(7),
    ]);
    await openFiles(rig);
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toHaveTextContent(pl.upload.reasons.quarantined, { exact: false });
    expect(screen.getByTestId(`order-file-${ID(2)}`)).toHaveTextContent(pl.upload.reasons.id_conflict, { exact: false });
    expect(screen.getByTestId(`order-file-${ID(3)}`)).toHaveTextContent(pl.upload.reasons.missing_original, { exact: false });
    expect(screen.queryByTestId(`order-file-${ID(1)}-retry`)).toBeNull();
    expect(screen.getByTestId(`order-file-${ID(1)}-discard`)).toBeOnTheScreen();
    expect(screen.getByTestId(`order-file-${ID(2)}-retry`)).toBeOnTheScreen();
    expect(screen.getByTestId(`order-file-${ID(3)}-discard`)).toBeOnTheScreen();
    expect(screen.getByTestId(`order-file-${ID(4)}-retry`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`order-file-${ID(4)}-discard`)).toBeNull();
    // waiting, sending and waiting for Wi-Fi have no action at all
    for (const n of [5, 6, 7]) {
      expect(screen.queryByTestId(`order-file-${ID(n)}-retry`)).toBeNull();
      expect(screen.queryByTestId(`order-file-${ID(n)}-discard`)).toBeNull();
    }
    // the technical reason of the quarantine and the raw code never reach the screen
    expect(whole()).not.toMatch(/quarantined|id_conflict|missing_original|checksum_mismatch/);
    expect(within(screen.getByTestId('order-files')).queryByText(/quarantined|id_conflict|missing_original|checksum_mismatch/)).toBeNull();
  });

  it.each([
    'unknown_future_code',
    '/data/user/0/pl.eviacharge.manager/files/secret-key.jpg',
    'uploads/2026/11/secret-key/0194c2a0-0000-7000-8000-000000000001',
    'file:///storage/emulated/0/secret-key.mp4',
  ])(
    'EVM-111 AC4 (negative d): a code this version does not know (%s) is only "Nie udało się wysłać pliku. Spróbuj ponownie." with "Ponów" - never "Usuń z telefonu", never the code on the screen, in a name or in a log',
    async (code) => {
      const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error'), jest.spyOn(console, 'info')].map(
        (spy) => spy.mockImplementation(() => undefined),
      );
      try {
        const rig = rigWith([file(1, { status: 'attention', code, actions: ['retry'] })]);
        await openFiles(rig);
        const row = screen.getByTestId(`order-file-${ID(1)}`);
        expect(row).toHaveTextContent('Nie udało się wysłać pliku. Spróbuj ponownie.', { exact: false });
        expect(screen.getByTestId(`order-file-${ID(1)}-retry`)).toBeOnTheScreen();
        expect(screen.queryByTestId(`order-file-${ID(1)}-discard`)).toBeNull();
        expect(screen.queryByRole('button', { name: pl.upload.discardA11y })).toBeNull();
        expect(whole()).not.toContain(code);
        expect(whole()).not.toMatch(/secret-key|unknown_future_code/);
        for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
      } finally {
        for (const spy of logs) spy.mockRestore();
      }
    },
  );

  it('EVM-111 AC4: "Ponów" hands the file back to the module; a refusal says so in words and the list stays; offline it is no error (the file waits for the network)', async () => {
    const rig = rigWith([file(1, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] })]);
    await openFiles(rig, offline);
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-retry`));
    await settle();
    expect(calls(rig)).toEqual([`retry:${ID(1)}`]);
    expect(screen.queryByTestId('order-files-notice')).toBeNull();
    rig.media.retryResult = false;
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-retry`));
    await settle();
    expect(screen.getByTestId('order-files-notice')).toHaveTextContent(pl.upload.retryFailed, { exact: false });
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toBeOnTheScreen();
    jest.spyOn(rig.media, 'retry').mockRejectedValueOnce(new Error('synthetic'));
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-retry`));
    await settle();
    expect(screen.getByTestId('order-files-notice')).toBeOnTheScreen();
  });

  it('EVM-111 AC4: "Usuń z telefonu" asks first; "Anuluj" changes nothing, the confirmation removes the file through the module and the list updates; a refusal says so', async () => {
    const rig = rigWith([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] })]);
    await openFiles(rig);
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-discard`));
    expect(screen.getByTestId('file-discard-dialog')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('file-discard-cancel'));
    expect(calls(rig)).toEqual([]);
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-discard`));
    rig.media.discardResult = false;
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    expect(calls(rig)).toEqual([`discard:${ID(1)}`]);
    expect(screen.getByTestId('order-files-notice')).toHaveTextContent(pl.attention.failed, { exact: false });
    rig.media.discardResult = true;
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-discard`));
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    await act(() => {
      rig.media.set(snap([]));
    });
    expect(screen.queryByTestId(`order-file-${ID(1)}`)).toBeNull();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('Wszystko wysłane', { exact: true });
  });

  it('EVM-111 AC4: a file leaving while its action is running (confirmed meanwhile) simply drops off the list - the count follows', async () => {
    const rig = rigWith([file(1, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }), file(2)]);
    await openFiles(rig);
    await act(() => {
      rig.media.set(snap([file(2)], { confirmed: 1 }));
    });
    expect(screen.queryByTestId(`order-file-${ID(1)}`)).toBeNull();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('1 do wysłania', { exact: true });
  });
});

describe('"Pliki zlecenia" - roles, hidden data, the lock and the session (EVM-111 AC6)', () => {
  it('EVM-111 AC6: a user who is not signed in sees the sign-in - no row, no screen, no file', async () => {
    const owner = stubOwner();
    owner.restoreResult = { kind: 'signed_out' };
    const rig = stubPorts(owner);
    rig.media.set(snap([file(1)]));
    await open(rig);
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-row')).toBeNull();
    expect(screen.queryByTestId('order-files')).toBeNull();
    expect(whole()).not.toMatch(SECRETS);
  });

  it('EVM-111 AC6: with the data hidden the details have no row "Pliki z tego telefonu" (the whole details are the notice)', async () => {
    const rig = rigWith([file(1)]);
    await openDetail(rig);
    expect(screen.getByTestId('order-files-row')).toBeOnTheScreen();
    await hide(rig);
    expect(screen.queryByTestId('order-files-row')).toBeNull();
    expect(whole()).not.toContain('do wysłania');
  });

  it('EVM-111 AC6 (negative e): hiding the data while the screen is open removes the rows, the count and the number at once and the reader hears nothing - not even "Wszystko wysłane" or a change of the number; the return brings the list back', async () => {
    const rig = rigWith([file(1), file(2)]);
    await openFiles(rig);
    expect(screen.getByTestId('order-files-count')).toBeOnTheScreen();
    announce.mockClear();
    await hide(rig);
    expect(screen.getByTestId('order-files-hidden')).toBeOnTheScreen();
    expect(screen.getByText('Dane zleceń są ukryte. Pliki wyślą się dalej — status zobaczysz w Kolejce.')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-count')).toBeNull();
    expect(screen.queryByTestId(`order-file-${ID(1)}`)).toBeNull();
    expect(screen.queryByTestId('order-files-list')).toBeNull();
    const text = whole();
    expect(text).not.toMatch(SECRETS);
    expect(text).not.toContain('do wysłania');
    expect(text).not.toContain('ZL-2026-0042');
    // the last file is confirmed WHILE hidden: still nothing is said
    jest.useFakeTimers();
    await act(() => {
      rig.media.set(snap([file(2)], { confirmed: 1 }));
    });
    await act(() => {
      rig.media.set(snap([], { confirmed: 2 }));
    });
    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    jest.useRealTimers();
    expect(announce).not.toHaveBeenCalled();
    // the data return: the list is drawn again (here: "Wszystko wysłane") and the past is not announced
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.queryByTestId('order-files-hidden')).toBeNull();
    expect(screen.getByTestId('order-files-count')).toHaveTextContent('Wszystko wysłane', { exact: true });
    expect(announce).not.toHaveBeenCalled();
  });

  it('EVM-111 AC6: a hidden screen offers the way out of the notice of the orders (the action of its reason) and a dialog that was open is gone', async () => {
    const rig = rigWith([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] })]);
    await openFiles(rig);
    await fireEvent.press(screen.getByTestId(`order-file-${ID(1)}-discard`));
    expect(screen.getByTestId('file-discard-dialog')).toBeOnTheScreen();
    await hide(rig);
    expect(screen.queryByTestId('file-discard-dialog')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sprawdź ponownie' }));
    await settle();
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    // the dialog does not come back with the data
    expect(screen.queryByTestId('file-discard-dialog')).toBeNull();
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toBeOnTheScreen();
  });

  it('EVM-111 AC6: the lock of the app takes the rows, the count and the number away as well (the cover is above; underneath only the sentence), without a sound; the unlock brings the list back', async () => {
    const rig = rigWith([file(1)]);
    await openFiles(rig);
    announce.mockClear();
    rig.device.facts.auth = 'cancelled';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot = rig.device.time.boot + 6 * MIN;
      rig.device.time.wall += 6 * MIN;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(screen.getByTestId('order-files-hidden', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId(`order-file-${ID(1)}`, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('order-files-count', { includeHiddenElements: true })).toBeNull();
    // a locked screen has no action of its own: the cover asks for the unlock
    expect(screen.queryByTestId('order-files-hidden-action', { includeHiddenElements: true })).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    rig.device.facts.auth = 'success';
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.getByTestId(`order-file-${ID(1)}`)).toBeOnTheScreen();
  });

  it('EVM-111 AC6: the row of the details is not there either while the app is locked', async () => {
    const rig = rigWith([file(1)]);
    await openDetail(rig);
    rig.device.facts.auth = 'cancelled';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot = rig.device.time.boot + 6 * MIN;
      rig.device.time.wall += 6 * MIN;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-files-row', { includeHiddenElements: true })).toBeNull();
  });

  it('EVM-111 AC6: nothing about the files appears in the accessible names or in a log (a file name, a path or a code of the module) and no permission or notification is asked for', async () => {
    const rig = rigWith([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] }), file(2)]);
    await openFiles(rig);
    expect(whole()).not.toMatch(/secret-key|\.jpg|\.mp4|\/data\//);
    expect(calls(rig)).toEqual([]);
  });
});

describe('"Pliki zlecenia" - the way back (EVM-111 AC1)', () => {
  it('EVM-111 AC1: "Wstecz" returns to the order (not to the list), and the system "back" closes this screen first', async () => {
    const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return {
        remove: () => {
          handlers.splice(handlers.indexOf(handler), 1);
        },
      };
    });
    try {
      const rig = rigWith([file(1)]);
      await openFiles(rig);
      expect(screen.getByRole('button', { name: pl.orderFiles.backA11y })).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('order-files-back'));
      await settle();
      expect(screen.queryByTestId('order-files')).toBeNull();
      expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('order-files-row'));
      await settle();
      let handled = false;
      await act(() => {
        handled = handlers.at(-1)?.(undefined as never) ?? false;
      });
      expect(handled).toBe(true);
      await settle();
      expect(screen.queryByTestId('order-files')).toBeNull();
      expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
      await act(() => {
        handled = handlers.at(-1)?.(undefined as never) ?? false;
      });
      await settle();
      expect(screen.queryByTestId('order-detail')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('EVM-111 AC1: the order under "Pliki zlecenia" is out of reach of touch and of the reader; leaving the order by the tabs closes the screen too', async () => {
    const rig = rigWith([file(1)]);
    await openFiles(rig);
    expect(screen.getByTestId('order-detail', { includeHiddenElements: true }).parent).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.queryByTestId('order-files')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.orders.title }));
    await settle();
    expect(screen.queryByTestId('order-files')).toBeNull();
    expect(screen.queryByTestId('order-detail')).toBeNull();
  });
});
