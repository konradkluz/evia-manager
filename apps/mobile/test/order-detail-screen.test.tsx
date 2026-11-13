import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import { BackHandler, Linking } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import type { JournalItem, OrderDetail } from '../src/orders/order-detail-model';
import { buildOrderList, type OrderListSource, type OrderRow } from '../src/orders/order-list-model';
import { type StartupChecker } from '../src/startup';
import { DAY } from './device-guard/fakes';
import { stubOwner, stubPorts, type PortsRig } from './session-helpers';

// EVM-104 AC1-AC6: the details of a work order on the phone - read only, from the local database.
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
/** The whole rendered tree as text, with every prop (accessibility labels included); circular references are cut. */
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

/** The tree of the details screen only (the list under it is hidden but mounted and holds its own, list-level data). */
const detailTree = (): string => {
  const find = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return undefined;
    const json = node as { props?: { testID?: string }; children?: unknown[] };
    if (json.props?.testID === 'order-detail') return json;
    for (const child of json.children ?? []) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const out: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    if (typeof node !== 'object' || node === null) return;
    const json = node as { props?: { accessibilityLabel?: unknown; testID?: unknown; value?: unknown }; children?: unknown[] };
    for (const key of ['accessibilityLabel', 'testID', 'value'] as const) {
      const value = json.props?.[key];
      if (typeof value === 'string') out.push(value);
    }
    for (const child of json.children ?? []) collect(child);
  };
  collect(find(screen.toJSON()));
  return out.join(' | ');
};

const T0 = Date.UTC(2026, 10, 1, 12, 0);
const SOURCE: OrderListSource = {
  orders: [{ id: 'o1', number: 'ZL-2026-0042', status: 'in_progress', createdAt: T0 - 5 * DAY, customerId: 'c1', siteId: 's1' }],
  customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
  sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
  stages: [],
};
const ROWS: OrderRow[] = buildOrderList(SOURCE, []);

const item = (patch: Partial<JournalItem> & { id: string }): JournalItem => ({
  source: 'synced',
  kind: 'note',
  category: null,
  author: 'Anna Testowa',
  at: T0,
  body: 'Synthetic body',
  redacted: false,
  ...patch,
});
const DETAIL: OrderDetail = {
  id: 'o1',
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { name: 'Jan Łódzki Synthetic', phone: '+48 600 100 200', dial: '+48600100200' },
  location: {
    street: 'ul. Żółkiewskiego 7',
    city: '00-001 Łódź',
    spot: '15',
    level: '-1',
    powerKw: '40',
    operator: 'Operator Testowy',
    manager: 'Wspólnota Fikcyjna',
  },
  scope: [
    { id: 'i1', name: 'Instalacja zasilająca', quantity: 2 },
    { id: 'i2', name: 'Wallbox', quantity: 1 },
  ],
  processes: [
    {
      id: 'p1',
      name: 'Przyłączenie OSD',
      stages: [
        { id: 'st1', name: 'Wniosek do OSD', status: 'done', waitingFor: null },
        { id: 'st2', name: 'Warunki przyłączenia', status: 'waiting', waitingFor: 'Operator Testowy' },
        { id: 'st3', name: 'Umowa', status: 'todo', waitingFor: null },
        { id: 'st4', name: 'Odbiór', status: 'brand_new', waitingFor: null },
      ],
    },
  ],
  journal: [
    item({ id: 'j-pending', source: 'pending', author: null, body: 'Z kolejki, czeka', at: T0 + 5 * 60_000 }),
    item({ id: 'j-attention', source: 'attention', author: null, kind: 'comment', body: 'Odrzucony komentarz', at: T0 + 4 * 60_000 }),
    item({ id: 'j-1', category: 'phone_call', body: 'Klient prosi o termin' }),
    item({ id: 'j-2', kind: 'event', author: null, body: 'Zmieniono status', at: T0 - 60_000 }),
    item({ id: 'j-3', redacted: true, body: null, at: T0 - 120_000 }),
  ],
};
const NAMES = /Łódzki|Żółkiewskiego|Łódź|Operator Testowy|Wspólnota Fikcyjna|Klient prosi|600 100 200|600100200|Z kolejki|Odrzucony|Garaż/;

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const rigWith = (detail: OrderDetail | null = DETAIL): PortsRig => {
  const rig = stubPorts();
  rig.sync.rows = ROWS;
  if (detail !== null) rig.sync.details.set('o1', detail);
  return rig;
};
const openDetail = async (rig: PortsRig) => {
  await open(rig);
  await fireEvent.press(screen.getByTestId('order-row-o1'));
  await settle();
};
const textOf = (node: { props: { children?: unknown } }): string => {
  const { children } = node.props;
  return typeof children === 'string' ? children : '';
};
const flat = (node: { props: { style?: unknown } }): Record<string, number> =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, number>;
const hide = async (rig: PortsRig) => {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};

let openUrl: jest.SpyInstance;
beforeEach(() => {
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => {
  openUrl.mockRestore();
});

describe('open and header (EVM-104 AC1)', () => {
  it('EVM-104 AC1: a touch on the row opens the details with the number, title and status - read from the local database only', async () => {
    const rig = rigWith();
    await openDetail(rig);
    expect(rig.sync.detailRequests).toEqual(['o1']);
    expect(rig.sync.calls.filter((call) => call.startsWith('enqueue') || call === 'trigger')).toEqual([]);
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail')).getByText('ZL-2026-0042')).toBeOnTheScreen();
    expect(screen.getByText('Garaż — pełny proces')).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail-status')).getByText(pl.shell.orders.status.in_progress)).toBeOnTheScreen();
  });

  it('EVM-104 AC1: "Wstecz" returns to the list with the query kept (the position of the list is kept too - it stays mounted)', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.changeText(screen.getByLabelText(pl.shell.orders.searchLabel), 'lodz');
    await settle();
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-detail-back'));
    await settle();
    expect(screen.queryByTestId('order-detail')).toBeNull();
    expect(screen.getByLabelText(pl.shell.orders.searchLabel).props.value).toBe('lodz');
    expect(screen.getByTestId('order-row-o1')).toBeOnTheScreen();
  });

  it('EVM-104 AC1: the list under the details is hidden from the screen reader and from touch; the back action has a full name', async () => {
    await openDetail(rigWith());
    expect(detailTree()).toContain(pl.orderDetail.backA11y);
    expect(screen.queryByTestId('orders-list')).toBeNull();
    const hidden = screen.getByTestId('orders-list', { includeHiddenElements: true });
    expect(hidden).toBeTruthy();
  });

  it('EVM-104 AC1: an unauthenticated user sees the sign-in, never the details (no read of the model)', async () => {
    const owner = stubOwner();
    owner.restoreResult = { kind: 'signed_out' };
    const rig = stubPorts(owner);
    rig.sync.rows = ROWS;
    rig.sync.details.set('o1', DETAIL);
    await open(rig);
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail')).toBeNull();
    expect(rig.sync.detailRequests).toEqual([]);
    expect(whole()).not.toMatch(NAMES);
  });

  it('EVM-104 AC1: loading is a skeleton, a failed read is a message with "Spróbuj ponownie" that reads again', async () => {
    const rig = rigWith();
    let fail = true;
    rig.sync.orderDetailHook = (id) =>
      fail ? Promise.reject(new Error('read failed (synthetic)')) : Promise.resolve(rig.sync.details.get(id) ?? null);
    await openDetail(rig);
    expect(screen.getByTestId('order-detail-error')).toBeOnTheScreen();
    expect(whole()).not.toContain('read failed');
    fail = false;
    await fireEvent.press(screen.getByTestId('order-detail-retry'));
    await settle();
    expect(screen.getByTestId('order-detail-customer')).toBeOnTheScreen();
  });

  it('EVM-104 AC1: while the first read runs the screen shows the skeleton', async () => {
    const rig = rigWith();
    rig.sync.orderDetailHook = () => new Promise(() => undefined);
    await openDetail(rig);
    expect(screen.getByTestId('order-detail-skeleton')).toBeOnTheScreen();
    expect(detailTree()).not.toMatch(NAMES);
  });
});

describe('edges of the screen (EVM-104 AC1, AC2, AC4, AC6)', () => {
  it('EVM-104 AC1: a status the app does not know is only the "Nieznany status" badge, and an order without a number has the neutral title', async () => {
    await openDetail(rigWith({ ...DETAIL, status: 'brand_new_status', number: null }));
    expect(within(screen.getByTestId('order-detail-status')).getByText(pl.shell.orders.unknownStatus)).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail')).getAllByText(pl.orderDetail.titleFallback).length).toBeGreaterThan(0);
  });

  it('EVM-104 AC1: the pressed state of the row is a visual effect only (the press opens the details)', async () => {
    await open(rigWith());
    const user = userEvent.setup();
    await user.press(screen.getByTestId('order-row-o1'));
    await settle();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
  });

  it('EVM-104 AC1: the system "back" closes the details first, and a second one leaves the list as before', async () => {
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
      await openDetail(rigWith());
      let handled = false;
      await act(() => {
        handled = handlers.at(-1)?.(undefined as never) ?? false;
      });
      expect(handled).toBe(true);
      await settle();
      expect(screen.queryByTestId('order-detail')).toBeNull();
      expect(screen.getByTestId('orders-list')).toBeOnTheScreen();
    } finally {
      spy.mockRestore();
    }
  });

  it('EVM-104 AC1: a failed refresh keeps the details that are already shown (no flicker to an error)', async () => {
    const rig = rigWith();
    await openDetail(rig);
    rig.sync.orderDetailHook = () => Promise.reject(new Error('read failed (synthetic)'));
    await act(() => {
      rig.sync.set({ lastSuccessAt: 321 });
    });
    await settle();
    expect(screen.queryByTestId('order-detail-error')).toBeNull();
    expect(screen.getByTestId('order-detail-customer')).toBeOnTheScreen();
  });

  it('EVM-104 AC2: a place with only a spot shows the spot and no address; a note without an author and an entry without text show no empty parts', async () => {
    const detail: OrderDetail = {
      ...DETAIL,
      location: { street: null, city: null, spot: '15', level: null, powerKw: null, operator: null, manager: null },
      journal: [item({ id: 'j-anon', author: null, body: null })],
    };
    await openDetail(rigWith(detail));
    const location = screen.getByTestId('order-detail-location');
    expect(within(location).queryByText(pl.orderDetail.address)).toBeNull();
    expect(within(location).getByText(pl.orderDetail.spot)).toBeOnTheScreen();
    const entry = screen.getByTestId('order-detail-entry-j-anon');
    expect(within(entry).getByText(/^Wpis · /)).toBeOnTheScreen();
    expect(within(entry).queryByText(pl.orderDetail.system)).toBeNull();
  });

  it('EVM-104 AC6: when the contact window elapses while the details are open, the action of EVM-101 signs in again and the details are not drawn', async () => {
    const rig = rigWith();
    await openDetail(rig);
    rig.device.facts.contact = { status: { visible: false, reason: 'window_elapsed', elapsedMs: 8 * DAY }, windowDays: 7 };
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('hidden-contact_expired')).toBeOnTheScreen();
    expect(detailTree()).not.toMatch(NAMES);
    await fireEvent.press(screen.getByTestId('hidden-action'));
    await settle();
    expect(rig.owner.calls).toContain('signOut:online');
  });
});

describe('customer and location (EVM-104 AC2)', () => {
  it('EVM-104 AC2: the customer, phone, address, place, level, power, operator and manager are shown; "Zadzwoń" has the name of the customer', async () => {
    await openDetail(rigWith());
    const customer = screen.getByTestId('order-detail-customer');
    expect(within(customer).getByText('Jan Łódzki Synthetic')).toBeOnTheScreen();
    expect(within(customer).getByText('+48 600 100 200')).toBeOnTheScreen();
    expect(screen.getByLabelText('Zadzwoń: Jan Łódzki Synthetic')).toBeOnTheScreen();
    const location = screen.getByTestId('order-detail-location');
    for (const text of ['ul. Żółkiewskiego 7, 00-001 Łódź', '15', '-1', '40 kW', 'Operator Testowy', 'Wspólnota Fikcyjna']) {
      expect(within(location).getByText(text)).toBeOnTheScreen();
    }
  });

  it('EVM-104 AC2 (security K7): "Zadzwoń" opens the dialer with the sanitised number only - no permission, no mail, tax id, PPE, payment or map', async () => {
    await openDetail(rigWith());
    await fireEvent.press(screen.getByTestId('order-detail-call'));
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith('tel:+48600100200');
    expect(detailTree()).not.toMatch(/e-?mail|płatno|mapy|maps|geo:/i);
    expect(detailTree()).not.toMatch(/\b(NIP|PPE)\b/);
  });

  it('EVM-104 AC2 (security K6): a failure of the dialer is a fixed message - the number is not in it and nothing is logged', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      openUrl.mockRejectedValue(new Error('no dialer +48600100200'));
      await openDetail(rigWith());
      await fireEvent.press(screen.getByTestId('order-detail-call'));
      await settle();
      expect(screen.getByTestId('order-detail-call-failed')).toHaveTextContent(pl.orderDetail.callFailed);
      expect(whole()).not.toContain('no dialer');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-104 AC2: a customer without a number (or with an unsafe one) has no "Zadzwoń"; a missing field leaves no empty label', async () => {
    const detail: OrderDetail = {
      ...DETAIL,
      customer: { name: 'Jan Łódzki Synthetic', phone: '*31#', dial: null },
      location: { street: 'ul. Żółkiewskiego 7', city: null, spot: null, level: null, powerKw: null, operator: null, manager: null },
    };
    await openDetail(rigWith(detail));
    expect(screen.queryByTestId('order-detail-call')).toBeNull();
    const location = screen.getByTestId('order-detail-location');
    expect(within(location).getByText(pl.orderDetail.address)).toBeOnTheScreen();
    for (const label of [
      pl.orderDetail.spot,
      pl.orderDetail.level,
      pl.orderDetail.power,
      pl.orderDetail.operator,
      pl.orderDetail.manager,
    ]) {
      expect(within(location).queryByText(label)).toBeNull();
    }
  });

  it('EVM-104 AC2: without a customer or a place the cards are not rendered at all', async () => {
    await openDetail(rigWith({ ...DETAIL, customer: null, location: null }));
    expect(screen.queryByTestId('order-detail-customer')).toBeNull();
    expect(screen.queryByTestId('order-detail-location')).toBeNull();
  });
});

describe('scope, processes and stages (EVM-104 AC3)', () => {
  it('EVM-104 AC3: the scope items, the processes with stages in the order of the data, each stage with a StatusBadge and, when waiting, the party', async () => {
    await openDetail(rigWith());
    const scope = screen.getByTestId('order-detail-scope');
    expect(within(scope).getByText('Instalacja zasilająca')).toBeOnTheScreen();
    expect(within(scope).getByText('Ilość: 2')).toBeOnTheScreen();
    expect(within(scope).queryByText('Ilość: 1')).toBeNull();
    const processes = screen.getByTestId('order-detail-processes');
    expect(within(processes).getByText('Przyłączenie OSD')).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail-stage-st1')).getByText(pl.orderDetail.stageStatus.done)).toBeOnTheScreen();
    const waiting = screen.getByTestId('order-detail-stage-st2');
    expect(within(waiting).getByText(pl.orderDetail.stageStatus.waiting)).toBeOnTheScreen();
    expect(within(waiting).getByText('Czekamy na: Operator Testowy')).toBeOnTheScreen();
    expect(waiting.props.accessibilityLabel).toBe('Warunki przyłączenia, Czekamy na…, Czekamy na: Operator Testowy');
    expect(within(screen.getByTestId('order-detail-stage-st3')).getByText(pl.orderDetail.stageStatus.todo)).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail-stage-st4')).getByText(pl.orderDetail.stageStatus.unknown)).toBeOnTheScreen();
    const names = screen.getAllByTestId(/^order-detail-stage-st/).map((node) => (node.props as { testID: string }).testID);
    expect(names).toEqual(['order-detail-stage-st1', 'order-detail-stage-st2', 'order-detail-stage-st3', 'order-detail-stage-st4']);
  });

  it('EVM-104 AC3: read only - no button inside the scope and the processes', async () => {
    await openDetail(rigWith());
    expect(within(screen.getByTestId('order-detail-scope')).queryAllByRole('button')).toEqual([]);
    expect(within(screen.getByTestId('order-detail-processes')).queryAllByRole('button')).toEqual([]);
  });

  it('EVM-104 AC3: an order without scope or processes shows the messages of M-03', async () => {
    await openDetail(rigWith({ ...DETAIL, scope: [], processes: [] }));
    expect(screen.getByText('Zlecenie nie ma jeszcze pozycji zakresu.')).toBeOnTheScreen();
    expect(screen.getByText('Zlecenie nie ma jeszcze procesów.')).toBeOnTheScreen();
  });
});

describe('journal and queue items (EVM-104 AC4)', () => {
  it('EVM-104 AC4: the entries as the model gives them - author, time, category, kind marker, redacted text; queue items carry the badge', async () => {
    await openDetail(rigWith());
    const pending = screen.getByTestId('order-detail-entry-j-pending');
    expect(within(pending).getByText(pl.orderDetail.pending)).toBeOnTheScreen();
    expect(within(pending).getByText('Z kolejki, czeka')).toBeOnTheScreen();
    expect(within(pending).getByText(/Ty/)).toBeOnTheScreen();
    const synced = screen.getByTestId('order-detail-entry-j-1');
    expect(within(synced).getByText(/Wpis · Rozmowa telefoniczna · Anna Testowa/)).toBeOnTheScreen();
    expect(within(synced).queryByText(pl.orderDetail.pending)).toBeNull();
    expect(within(screen.getByTestId('order-detail-entry-j-2')).getByText(/Zdarzenie · System/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail-entry-j-3')).getByText(pl.orderDetail.redacted)).toBeOnTheScreen();
    const ids = screen.getAllByTestId(/^order-detail-entry-j-/).map((node) => (node.props as { testID: string }).testID);
    expect(ids).toEqual(['j-pending', 'j-attention', 'j-1', 'j-2', 'j-3'].map((id) => `order-detail-entry-${id}`));
  });

  it('EVM-104 AC4: a rejected item shows "Wymaga uwagi" and "Przejdź do kolejki", which opens the queue', async () => {
    await openDetail(rigWith());
    const attention = screen.getByTestId('order-detail-entry-j-attention');
    expect(within(attention).getByText(pl.orderDetail.attention)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-detail-entry-queue-j-attention'));
    await settle();
    expect(screen.queryByTestId('order-detail')).toBeNull();
    expect(screen.getByRole('tab', { name: pl.shell.queue.title }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('EVM-104 AC4: after the send the item becomes a plain entry (the next read has no pending badge and no duplicate)', async () => {
    const rig = rigWith();
    await openDetail(rig);
    expect(screen.getAllByText(pl.orderDetail.pending)).toHaveLength(1);
    rig.sync.details.set('o1', { ...DETAIL, journal: [item({ id: 'j-pending', body: 'Z kolejki, czeka' }), ...DETAIL.journal.slice(2)] });
    await act(() => {
      rig.sync.set({ lastSuccessAt: 123 });
    });
    await settle();
    expect(screen.queryByText(pl.orderDetail.pending)).toBeNull();
    expect(screen.getAllByTestId('order-detail-entry-j-pending')).toHaveLength(1);
    expect(within(screen.getByTestId('order-detail-entry-j-pending')).getByText('Z kolejki, czeka')).toBeOnTheScreen();
  });

  it('EVM-104 AC4: an empty journal says "Brak wpisów."', async () => {
    await openDetail(rigWith({ ...DETAIL, journal: [] }));
    expect(screen.getByText('Brak wpisów.')).toBeOnTheScreen();
  });

  it('EVM-104 AC4 (security K8): the body is plain text - not selectable, no link detection, no markup', async () => {
    const link = 'https://example.test/x <b>bold</b> [a](https://example.test)';
    await openDetail(rigWith({ ...DETAIL, journal: [item({ id: 'j-link', body: link })] }));
    const body = within(screen.getByTestId('order-detail-entry-j-link')).getByText(link);
    expect(body.props.selectable).toBeFalsy();
    expect(body.props.dataDetectorType).toBeUndefined();
    expect(body.props.onPress).toBeUndefined();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('unavailable order (EVM-104 AC5)', () => {
  it('EVM-104 AC5: an order that is not in the replica shows the message and "Wróć do listy" - no data of the order', async () => {
    const rig = rigWith(null);
    await openDetail(rig);
    expect(screen.getByText(pl.orderDetail.unavailableBody)).toBeOnTheScreen();
    expect(detailTree()).not.toMatch(NAMES);
    await fireEvent.press(screen.getByTestId('order-detail-unavailable-back'));
    await settle();
    expect(screen.queryByTestId('order-detail')).toBeNull();
  });

  it('EVM-104 AC5 (security K4): the order leaves the scope while it is open - at the next refresh the data are gone and the message is shown', async () => {
    const rig = rigWith();
    await openDetail(rig);
    expect(screen.getByTestId('order-detail-customer')).toBeOnTheScreen();
    rig.sync.details.delete('o1');
    await act(() => {
      rig.sync.set({ lastSuccessAt: 456 });
    });
    await settle();
    expect(screen.getByTestId('order-detail-unavailable')).toBeOnTheScreen();
    expect(detailTree()).not.toMatch(NAMES);
    expect(rig.sync.calls.filter((call) => /discard|recreate|retarget/.test(call))).toEqual([]);
  });
});

describe('hidden-data mode, sign-out, privacy and accessibility (EVM-104 AC6)', () => {
  it('EVM-104 AC6 (security K3): the mode starts while the details are open - the model is zeroed at once and the action of EVM-101 is offered', async () => {
    const rig = rigWith();
    await openDetail(rig);
    expect(screen.getByTestId('order-detail-customer')).toBeOnTheScreen();
    await hide(rig);
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    expect(whole()).not.toMatch(NAMES);
    expect(screen.getByTestId('hidden-action')).toBeOnTheScreen();
    // back from the mode the details are read afresh (the old model is not reused)
    const before = rig.sync.detailRequests.length;
    rig.device.facts.secure = true;
    await fireEvent.press(screen.getByTestId('hidden-action'));
    await settle();
    expect(rig.sync.detailRequests.length).toBeGreaterThan(before);
    expect(screen.getByTestId('order-detail-customer')).toBeOnTheScreen();
  });

  it('EVM-104 AC6 (security K3): a late answer that arrives after the mode started is dropped; no read with data starts in the mode', async () => {
    const rig = rigWith();
    let release: (detail: OrderDetail | null) => void = () => undefined;
    const late = new Promise<OrderDetail | null>((resolve) => {
      release = resolve;
    });
    let first = true;
    rig.sync.orderDetailHook = (id) => {
      if (first) {
        first = false;
        return late;
      }
      return Promise.resolve(rig.sync.details.get(id) ?? null);
    };
    await openDetail(rig);
    expect(rig.sync.detailRequests).toEqual(['o1']);
    await hide(rig);
    await act(async () => {
      release(DETAIL);
      await Promise.resolve();
    });
    await settle();
    expect(whole()).not.toMatch(NAMES);
    expect(rig.sync.detailRequests).toEqual(['o1']);
  });

  it('EVM-104 AC6 (security K3): "checking" (an unreadable lock state) is the hidden mode too - nothing is read, nothing shown', async () => {
    const rig = rigWith();
    rig.device.facts.secure = 'throws';
    await open(rig);
    expect(whole()).not.toMatch(NAMES);
    expect(rig.sync.detailRequests).toEqual([]);
  });

  it('EVM-104 AC6 (security K3): sign-out while the details are open leaves no data on the screen', async () => {
    const rig = rigWith();
    await openDetail(rig);
    await act(() => {
      rig.owner.end({ reason: 'signed_out', unsentItems: 0 });
    });
    await settle();
    expect(screen.queryByTestId('order-detail')).toBeNull();
    expect(whole()).not.toMatch(NAMES);
  });

  it('EVM-104 AC6: the sections have headings for the screen reader and the targets are at least 48 dp', async () => {
    await openDetail(rigWith());
    const headings = screen.getAllByRole('header').map((node) => textOf(node));
    for (const title of [
      pl.orderDetail.customer,
      pl.orderDetail.location,
      pl.orderDetail.scope,
      pl.orderDetail.processes,
      pl.orderDetail.journal,
    ]) {
      expect(headings).toContain(title);
    }
    for (const id of ['order-detail-back', 'order-detail-call', 'order-detail-entry-queue-j-attention']) {
      expect(flat(screen.getByTestId(id)).minHeight).toBeGreaterThanOrEqual(48);
      expect(flat(screen.getByTestId(id)).minWidth).toBeGreaterThanOrEqual(48);
    }
  });

  it('EVM-104 AC6 (security K6, K8, K11): no logger, console, storage, persisted navigation, link detection or selectable text; the id is the only parameter', () => {
    const read = (name: string): string => readFileSync(join(__dirname, '..', 'src', 'screens', name), 'utf8');
    for (const name of ['OrderDetailScreen.tsx', 'OrderDetailSections.tsx', 'order-detail-hooks.ts']) {
      expect(read(name).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(
        /console\.|logWarning|logging\/log|AsyncStorage|SecureStore|setParams|navigate\(|useNavigation|persist|localStorage|selectable|dataDetector|canOpenURL|geo:|maps/,
      );
    }
    const shell = read('Shell.tsx');
    expect([...shell.matchAll(/useState<string \| null>\(null\)/g)]).toHaveLength(1);
    expect(shell).not.toMatch(/AsyncStorage|SecureStore|persist/);
    const config = readFileSync(join(__dirname, '..', 'app.config.ts'), 'utf8');
    expect(config).not.toMatch(/CALL_PHONE|<queries>|intentFilters/);
  });

  it('EVM-104 AC6: neither a name nor a number reaches the console while the details are opened, refreshed and closed', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const rig = rigWith();
      await openDetail(rig);
      await act(() => {
        rig.sync.set({ lastSuccessAt: 789 });
      });
      await settle();
      await fireEvent.press(screen.getByTestId('order-detail-back'));
      await settle();
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(NAMES);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
