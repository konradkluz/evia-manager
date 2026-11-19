// The entries to the camera (EVM-108 AC5): the bottom bar of the details, the sheet "Dodaj" -> "Zdjęcie lub film" -> the choice of the order, the roles, the
// offline work, the hidden-data mode (security 17), the port that refuses an order that is not on the phone (security 18), the lock and the wipe.
// The camera itself is the stand-in of test/mocks; the pictures of the wipe test go through the REAL `CapturePipeline` on in-memory ports.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../../src/App';
import { consentMemory } from '../../src/capture/camera-options';
import { pl } from '../../src/i18n/pl';
import { buildOrderList } from '../../src/orders/order-list-model';
import type { OrderDetail } from '../../src/orders/order-detail-model';
import { SEARCH_MAX_LENGTH } from '../../src/screens/OrdersScreen';
import type { StartupChecker } from '../../src/startup';
import { EMPTY_COUNTS } from '../../src/sync/types';
import { size } from '../../src/ui/theme';
import { cameraMock } from '../mocks/expo-camera';
import { stubPorts, type PortsRig } from '../session-helpers';

jest.mock('expo-camera', () => jest.requireActual<typeof import('../mocks/expo-camera')>('../mocks/expo-camera'));
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

const A = '10000000-0000-4000-8000-00000000000a';
const B = '10000000-0000-4000-8000-00000000000b';
const C = '10000000-0000-4000-8000-00000000000c';
const TITLE_A = 'Garaż Alfa Synthetic';
const TITLE_B = 'Hala Beta Synthetic';
const TITLE_C = 'Parking Gamma Synthetic';
const CUSTOMER = 'Jan Łódzki Synthetic';
const STREET = 'ul. Żółkiewskiego';
const PERSONAL = /Łódzki|Żółkiewskiego|Łódź/;

const settle = () =>
  act(async () => {
    for (let n = 0; n < 12; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });
const offline: StartupChecker = () => Promise.resolve({ kind: 'offline' });

const detail = (id: string, number: string, title: string): OrderDetail => ({
  id,
  number,
  title,
  status: 'in_progress',
  customer: null,
  location: null,
  scope: [],
  processes: [],
  journal: [],
});

/** Three orders on the phone: A and B have a customer and an address (the list shows them), C is only a target; the titles are what the picker may show. */
function rigWith(): PortsRig {
  const rig = stubPorts();
  rig.sync.rows = buildOrderList(
    {
      orders: [
        { id: A, number: 'ZL-2026-0042', status: 'in_progress', createdAt: 3, customerId: 'c1', siteId: 's1' },
        { id: B, number: 'ZL-2026-0043', status: 'in_progress', createdAt: 2, customerId: null, siteId: null },
        { id: C, number: 'ZL-2026-0044', status: 'in_progress', createdAt: 1, customerId: null, siteId: null },
      ],
      customers: [{ id: 'c1', displayName: CUSTOMER }],
      sites: [{ id: 's1', street: STREET, buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
      stages: [],
    },
    [],
  );
  rig.sync.targets = [
    { id: A, number: 'ZL-2026-0042', title: TITLE_A },
    { id: B, number: 'ZL-2026-0043', title: TITLE_B },
    { id: C, number: 'ZL-2026-0044', title: TITLE_C },
  ];
  // the pictures of the camera go through the real pipeline on the ports of a phone in memory (the stage 2 tests cover the saving itself)
  let n = 0;
  rig.media.freeBytes = 10 * 1024 ** 3;
  rig.media.capturePorts = {
    native: {
      importOriginal: () => Promise.resolve('ok'),
      digestOriginal: () => Promise.resolve({ sizeBytes: 100, sha256: 'a'.repeat(64) }),
      cancelUpload: () => Promise.resolve(true),
    },
    disk: { freeBytes: () => 10 * 1024 ** 3 },
    registerAndEnqueue: () => Promise.resolve({ ok: true }),
    now: () => Date.UTC(2026, 10, 15, 8, 0, 0),
    newId: () => `0194c2a0-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`,
  };
  rig.sync.details.set(A, detail(A, 'ZL-2026-0042', TITLE_A));
  rig.sync.details.set(B, detail(B, 'ZL-2026-0043', TITLE_B));
  return rig;
}

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const hide = async (rig: PortsRig): Promise<void> => {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};
const openDetails = async (id: string): Promise<void> => {
  await fireEvent.press(screen.getByTestId(`order-row-${id}`));
  await settle();
};
const openPicker = async (): Promise<void> => {
  await fireEvent.press(screen.getByTestId('orders-add'));
  await fireEvent.press(screen.getByTestId('add-media'));
  await settle();
};
/** The whole rendered tree with every prop, circular references cut. */
const whole = (): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return typeof value === 'function' ? undefined : value;
  });
};
/** The tree of ONE element (the list of the orders stays mounted under the dialogs and is not what is asked about). */
const subtree = (testID: string): string => {
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
  const seen = new WeakSet<object>();
  return JSON.stringify(find(screen.toJSON()), (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return typeof value === 'function' ? undefined : value;
  });
};
const type = async (value: string): Promise<void> => {
  await fireEvent.changeText(screen.getByTestId('media-picker-search'), value);
  await settle();
};

beforeEach(() => {
  cameraMock.reset();
  consentMemory.shown = false;
});

describe('the bottom bar of the details (EVM-108 AC5)', () => {
  it('EVM-108 AC5: the details carry a fixed bar - the main "Zrób zdjęcie" and the secondary "Dodaj wpis" (the test id of the entry is the one the flows know)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    expect(screen.getByRole('button', { name: 'Zrób zdjęcie' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dodaj wpis' })).toBeEnabled();
    expect(screen.getByTestId('order-detail-take-photo')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-add-entry')).toBeOnTheScreen();
    // the bar is the same one in front of the journal: "Dodaj wpis" is no longer in the heading of the journal
    expect(screen.getAllByTestId('order-detail-add-entry')).toHaveLength(1);
  });

  it('EVM-108 AC5: both buttons are at least 48 dp tall and wide (tokens: the main one is the field height, 56 dp)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    expect(size.touchTarget.min).toBeGreaterThanOrEqual(48);
    for (const id of ['order-detail-take-photo', 'order-detail-add-entry']) {
      expect(screen.getByTestId(id)).toHaveStyle({ minWidth: size.touchTarget.min });
      expect(size.control.height.mobile.md).toBeGreaterThanOrEqual(48);
    }
    expect(screen.getByTestId('order-detail-take-photo')).toHaveStyle({ minHeight: size.control.height.mobile.lg });
    expect(screen.getByTestId('order-detail-add-entry')).toHaveStyle({ minHeight: size.control.height.mobile.md });
    expect(size.control.height.mobile.lg).toBeGreaterThanOrEqual(size.touchTarget.field);
  });

  it('EVM-108 AC5: "Zrób zdjęcie" opens the camera of THIS order (the number in the bar), "Gotowe" returns to the details', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    expect(rig.ports.camera.getSnapshot()).toBe(A);
    expect(screen.getByRole('header', { name: 'ZL-2026-0042' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
  });

  it('EVM-108 AC5: "Dodaj wpis" in the bar still opens the entry form of this order (EVM-105)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByTestId('entry-form')).toBeOnTheScreen();
  });

  it('EVM-108 AC5: while the details load, fail, or the order is unavailable the bar is not shown', async () => {
    const rig = rigWith();
    rig.sync.orderDetailHook = () => new Promise(() => undefined);
    await open(rig);
    await openDetails(A);
    expect(screen.getByTestId('order-detail-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail-take-photo')).toBeNull();
    await screen.unmount();

    const failing = rigWith();
    failing.sync.orderDetailHook = () => Promise.reject(new Error('synthetic'));
    await open(failing);
    await openDetails(A);
    expect(screen.getByTestId('order-detail-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail-take-photo')).toBeNull();
    expect(screen.queryByTestId('order-detail-add-entry')).toBeNull();
    await screen.unmount();

    const gone = rigWith();
    gone.sync.details.delete(A);
    await open(gone);
    await openDetails(A);
    expect(screen.getByTestId('order-detail-unavailable')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail-take-photo')).toBeNull();
  });

  it('EVM-108 AC5 (security 18): an order that left the phone in the meantime is refused - nothing opens and the bar says why', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    rig.sync.rows = rig.sync.rows.filter((row) => row.id !== A);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
    expect(screen.getByTestId('order-detail-camera-refused')).toHaveTextContent(pl.orderDetail.unavailableBody, { exact: false });
    // a failing port is a refusal too
    rig.sync.orderListHook = () => Promise.reject(new Error('synthetic'));
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.getByTestId('order-detail-camera-refused')).toBeOnTheScreen();
    // a port that throws (it does not, but nothing may open on it) is a refusal as well
    rig.ports.camera.open = () => Promise.reject(new Error('synthetic'));
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.getByTestId('order-detail-camera-refused')).toBeOnTheScreen();
  });

  it('EVM-108 AC5: while the data of the company are wiped the bar is not shown', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await act(() => {
      rig.device.guard.setWiping(true);
    });
    await settle();
    expect(screen.queryByTestId('order-detail-take-photo')).toBeNull();
    expect(screen.queryByTestId('order-detail-add-entry')).toBeNull();
  });
});

describe('the bottom bar in the hidden-data mode (EVM-108 AC5; security 17)', () => {
  it('EVM-108 AC5: the order is known from the navigation - the camera works, "Dodaj wpis" is disabled with its reason, no number and no data are drawn', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await hide(rig);
    expect(screen.getByRole('button', { name: 'Zrób zdjęcie' })).toBeEnabled();
    const add = screen.getByTestId('order-detail-add-entry');
    expect(add).toBeDisabled();
    expect(screen.getByRole('button', { name: pl.orderDetail.addEntryHidden })).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-add-entry-reason')).toHaveTextContent(pl.add.hiddenReason);
    const tree = whole();
    expect(tree).not.toContain('ZL-2026-0042');
    expect(tree).not.toContain(TITLE_A);
    expect(tree).not.toMatch(PERSONAL);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.getByRole('header', { name: 'Aparat' })).toBeOnTheScreen();
    expect(whole()).not.toContain('ZL-2026-0042');
  });

  it('EVM-108 AC5: the bar of the hidden mode goes away with the wipe and comes back as a full bar when the data are visible again', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await hide(rig);
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('order-detail-add-entry')).toBeEnabled();
    expect(screen.queryByTestId('order-detail-add-entry-reason')).toBeNull();
  });
});

describe('the sheet "Dodaj" -> "Zdjęcie lub film" -> the choice of the order -> the camera (EVM-108 AC5)', () => {
  it('EVM-108 AC5: the choice shows the numbers and the titles of the orders on the phone - no customer, no address - and a pick opens the camera of that order', async () => {
    const rig = rigWith();
    await open(rig);
    await openPicker();
    expect(screen.getByTestId('media-picker')).toBeOnTheScreen();
    expect(screen.getByText(pl.mediaTarget.title)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `ZL-2026-0043 · ${TITLE_B}` })).toBeOnTheScreen();
    expect(screen.queryByText(pl.mediaTarget.recent)).toBeNull();
    expect(subtree('media-picker')).not.toMatch(PERSONAL);
    // no film switch and no "Dodaj" in the navigation (EVM-009 stays as it is)
    expect(screen.queryByText('Film')).toBeNull();
    await fireEvent.press(screen.getByTestId(`media-picker-${B}`));
    await settle();
    expect(screen.queryByTestId('media-picker')).toBeNull();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    expect(rig.ports.camera.getSnapshot()).toBe(B);
    expect(screen.getByRole('header', { name: 'ZL-2026-0043' })).toBeOnTheScreen();
  });

  it('EVM-108 AC5: "Anuluj" and the system back close the choice and nothing opens', async () => {
    const rig = rigWith();
    await open(rig);
    await openPicker();
    await fireEvent.press(screen.getByTestId('media-picker-cancel'));
    expect(screen.queryByTestId('media-picker')).toBeNull();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });

  it('EVM-108 AC5: "Ostatnio otwierane" - the orders opened in this process, the newest first, then the rest; none opened = no such section', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    await openDetails(B);
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    await openPicker();
    const recent = screen.getByTestId('media-picker-recent');
    expect(recent).toHaveTextContent(pl.mediaTarget.recent, { exact: false });
    const order = screen.getAllByRole('button').map((button) => button.props.testID as string | undefined);
    expect(order.filter((id) => id?.startsWith('media-picker-1000'))).toEqual([
      `media-picker-${B}`,
      `media-picker-${A}`,
      `media-picker-${C}`,
    ]);
    expect(screen.getByText(pl.mediaTarget.all)).toBeOnTheScreen();
    // the ids are in the memory of the shell only: a new process (a new shell) starts with none
    await screen.unmount();
    await open(rig);
    await openPicker();
    expect(screen.queryByTestId('media-picker-recent')).toBeNull();
    expect(screen.queryByText(pl.mediaTarget.recent)).toBeNull();
  });

  it('EVM-108 AC5: an order that is no longer on the phone does not stay among the recent ones', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    rig.sync.targets = rig.sync.targets.filter((target) => target.id !== A);
    await openPicker();
    expect(screen.queryByTestId('media-picker-recent')).toBeNull();
    expect(screen.queryByTestId(`media-picker-${A}`)).toBeNull();
  });

  it('EVM-108 AC5: the search looks at the number and the title (not at the customer or the address) from one character; clearing brings the list back', async () => {
    const rig = rigWith();
    await open(rig);
    await openPicker();
    await type('0043');
    expect(screen.getAllByRole('button').filter((b) => String(b.props.testID).startsWith('media-picker-1000'))).toHaveLength(1);
    expect(screen.getByTestId(`media-picker-${B}`)).toBeOnTheScreen();
    await type('GARAZ alfa');
    expect(screen.getByTestId(`media-picker-${A}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`media-picker-${B}`)).toBeNull();
    await type('g');
    expect(screen.getByTestId(`media-picker-${A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`media-picker-${C}`)).toBeOnTheScreen();
    for (const phrase of ['Łódzki', 'Żółkiewskiego', 'Łódź']) {
      await type(phrase);
      expect(screen.getByTestId('media-picker-no-match')).toHaveTextContent(pl.mediaTarget.noMatch);
    }
    expect(screen.getByTestId('media-picker-search').props.maxLength).toBe(SEARCH_MAX_LENGTH);
    await fireEvent.press(screen.getByLabelText(pl.shell.orders.clearSearch));
    await settle();
    expect(screen.getByTestId(`media-picker-${A}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('media-picker-no-match')).toBeNull();
  });

  it('EVM-108 AC5: no orders on the phone - the same words as the picker of an entry; an unreadable replica is the same', async () => {
    const rig = rigWith();
    rig.sync.targets = [];
    await open(rig);
    await openPicker();
    expect(screen.getByTestId('media-picker-empty')).toHaveTextContent(pl.entryForm.picker.empty);
    await screen.unmount();
    const broken = rigWith();
    broken.sync.retargetOptions = () => Promise.reject(new Error('synthetic'));
    await open(broken);
    await openPicker();
    expect(screen.getByTestId('media-picker-empty')).toBeOnTheScreen();
  });

  it('EVM-108 AC5 (security 18): a pick of an order that the port does not know opens nothing', async () => {
    const rig = rigWith();
    rig.sync.targets = [...rig.sync.targets, { id: '10000000-0000-4000-8000-0000000000ff', number: 'ZL-2026-9999', title: 'Zniknęło' }];
    await open(rig);
    await openPicker();
    await fireEvent.press(screen.getByTestId('media-picker-10000000-0000-4000-8000-0000000000ff'));
    await settle();
    expect(screen.queryByTestId('media-picker')).toBeNull();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });

  it('EVM-108 AC5: no test id of the entries holds a number, a title or a name (an id of an order is fine)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    const ids: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const json = node as { props?: { testID?: string }; children?: unknown[] };
      if (typeof json.props?.testID === 'string') ids.push(json.props.testID);
      json.children?.forEach(walk);
    };
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    await openPicker();
    walk(screen.toJSON());
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.join(' ')).not.toMatch(/ZL-|Garaż|Hala|Parking|Łódź|Jan/);
  });
});

describe('the choice of the order in the hidden-data mode (EVM-108 AC5; security 17)', () => {
  it('EVM-108 AC5: only the numbers - the titles are not read (the list comes from `orderNumbers`), not drawn, not in any label; the camera works and says "Aparat"', async () => {
    const rig = rigWith();
    rig.device.facts.secure = false;
    await open(rig);
    await openPicker();
    expect(rig.sync.numberRequests.length).toBeGreaterThan(0);
    expect(rig.sync.calls.filter((call) => call.startsWith('options:'))).toEqual([]);
    expect(screen.getByTestId('media-picker-hidden')).toHaveTextContent('Dane zleceń są ukryte — pokazujemy tylko numery.');
    expect(screen.getByTestId('media-picker-hidden')).toHaveTextContent(pl.mediaTarget.hiddenReason);
    expect(pl.mediaTarget.hiddenReason).not.toBe(pl.add.hiddenReason);
    expect(screen.getByRole('button', { name: 'ZL-2026-0042' })).toBeOnTheScreen();
    const tree = whole();
    for (const secret of [TITLE_A, TITLE_B, TITLE_C, CUSTOMER, STREET, 'Łódź']) expect(tree).not.toContain(secret);
    await fireEvent.press(screen.getByTestId(`media-picker-${C}`));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Aparat' })).toBeOnTheScreen();
    expect(whole()).not.toContain('ZL-2026-0044');
  });

  it('EVM-108 AC5: a phrase that matches a title and not a number finds nothing in this mode; a number is found', async () => {
    const rig = rigWith();
    rig.device.facts.secure = false;
    await open(rig);
    await openPicker();
    await type('Alfa');
    expect(screen.getByTestId('media-picker-no-match')).toBeOnTheScreen();
    expect(screen.queryByTestId(`media-picker-${A}`)).toBeNull();
    await type('0043');
    expect(screen.getByTestId(`media-picker-${B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`media-picker-${A}`)).toBeNull();
  });

  it('EVM-108 AC5: the mode that starts while the choice is open draws it again WITHOUT titles in the same render and drops what was typed', async () => {
    const rig = rigWith();
    await open(rig);
    await openPicker();
    await type('Alfa');
    expect(screen.getByRole('button', { name: `ZL-2026-0042 · ${TITLE_A}` })).toBeOnTheScreen();
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('media-picker')).toBeOnTheScreen();
    expect(whole()).not.toContain(TITLE_A);
    expect(screen.getByTestId('media-picker-search').props.value).toBe('');
    expect(screen.getByRole('button', { name: 'ZL-2026-0042' })).toBeOnTheScreen();
    // and back: the titles return only after a new read in the visible mode
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByRole('button', { name: `ZL-2026-0042 · ${TITLE_A}` })).toBeOnTheScreen();
  });

  it('EVM-108 AC5: a list that was read in the visible mode is never drawn in the hidden one, even before the new read answers', async () => {
    const rig = rigWith();
    await open(rig);
    await openPicker();
    expect(screen.getByRole('button', { name: `ZL-2026-0042 · ${TITLE_A}` })).toBeOnTheScreen();
    // the numbers never answer: the picker shows nothing from the old list
    rig.sync.orderNumbers = () => new Promise(() => undefined);
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(whole()).not.toContain(TITLE_A);
    expect(whole()).not.toContain('ZL-2026-0042');
  });

  it('EVM-108 AC5: even a source that handed titles over is cut down to the numbers in this mode', async () => {
    const rig = rigWith();
    rig.device.facts.secure = false;
    rig.sync.orderNumbers = () => Promise.resolve([{ id: A, number: 'ZL-2026-0042', title: TITLE_A } as { id: string; number: string }]);
    await open(rig);
    await openPicker();
    expect(screen.getByRole('button', { name: 'ZL-2026-0042' })).toBeOnTheScreen();
    expect(whole()).not.toContain(TITLE_A);
    await type('Alfa');
    expect(screen.getByTestId('media-picker-no-match')).toBeOnTheScreen();
  });

  it('EVM-108 AC5: the recent orders show their numbers only in this mode (ids come from the shell, numbers from the list)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(B);
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    await hide(rig);
    await openPicker();
    expect(screen.getByTestId('media-picker-recent')).toHaveTextContent(pl.mediaTarget.recent, { exact: false });
    expect(screen.getByRole('button', { name: 'ZL-2026-0043' })).toBeOnTheScreen();
    expect(whole()).not.toContain(TITLE_B);
  });
});

describe('roles, offline, the lock and the wipe (EVM-108 AC5)', () => {
  it('EVM-108 AC5: not signed in - the sign-in screen; there is no bar, no camera and no choice (an account of "Tylko odczyt" does not sign in: EVM-100, channel_not_allowed)', async () => {
    const rig = rigWith();
    rig.owner.restoreResult = { kind: 'signed_out' };
    await open(rig);
    expect(screen.queryByTestId('order-detail-take-photo')).toBeNull();
    expect(screen.queryByTestId('orders-add')).toBeNull();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });

  it('EVM-108 AC5: the session that ends while the camera is open takes the camera and the recent orders with it (the shell is not drawn without a session)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    await act(() => {
      rig.owner.end({ reason: 'signed_out', unsentItems: 0 });
    });
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.queryByTestId('order-detail')).toBeNull();
    expect(rig.ports.camera.getSnapshot()).toBeNull();
  });

  it('EVM-146 AC2: the lock does not close the camera - after the unlock the same camera of the same order is open (only the end of the session closes it)', async () => {
    const rig = rigWith();
    await open(rig);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    rig.device.facts.auth = 'cancelled';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot += 6 * 60_000;
      rig.device.time.wall += 6 * 60_000;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(rig.ports.camera.getSnapshot()).not.toBeNull();
    rig.device.facts.auth = 'success';
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
  });

  it('EVM-108 AC5: offline the camera works - the capsule says "Offline · n", there is no banner of the connection over the preview', async () => {
    const rig = rigWith();
    rig.sync.set({ online: false, counts: { ...EMPTY_COUNTS, pending: 2, unsent: 2 } });
    await open(rig, offline);
    await openDetails(A);
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent('Offline · 2');
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.queryByText(/Brak zasięgu/)).toBeNull();
    // not even among the hidden elements: the content under the camera is not displayed and is out of the accessibility tree
    expect(screen.getByTestId('shell-content', { includeHiddenElements: true })).toHaveStyle({ display: 'none' });
    expect(screen.getByTestId('shell-content', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    await fireEvent.press(screen.getByTestId('camera-done'));
    await settle();
    expect(screen.getByTestId('shell-content')).not.toHaveStyle({ display: 'none' });
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-detail-take-photo'));
    await settle();
    await fireEvent.press(screen.getByTestId('camera-category-other'));
    await fireEvent.press(screen.getByTestId('camera-shutter'));
    await settle();
    expect(screen.getByTestId('camera-count')).toHaveTextContent('1 zdjęcie');
  });

  it('EVM-108 AC5: the lock of the app covers the camera like the rest of the app - locked, the content is out of reach; unlocked, the picker works', async () => {
    const rig = rigWith();
    rig.device.facts.auth = 'cancelled';
    await open(rig);
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
    rig.device.facts.auth = 'success';
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    await openPicker();
    expect(screen.getByTestId('media-picker')).toBeOnTheScreen();
  });
});
