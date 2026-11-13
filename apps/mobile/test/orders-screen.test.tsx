import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueueRecord } from '@evia/sync-core';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { buildOrderList, queueFact, type OrderListSource, type OrderRow } from '../src/orders/order-list-model';
import { ANNOUNCE_AFTER_MS, SEARCH_MAX_LENGTH } from '../src/screens/OrdersScreen';
import { SLOW_CHECK_MS, type StartupChecker } from '../src/startup';
import { DAY, MIN } from './device-guard/fakes';
import { stubOwner, stubPorts, type PortsRig } from './session-helpers';
import { INITIAL_FIRST_PULL } from '../src/sync/types';

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

const T0 = Date.UTC(2026, 10, 1, 12, 0);
const SOURCE: OrderListSource = {
  orders: [
    { id: 'o-old', number: 'ZL-2026-0042', status: 'in_progress', createdAt: T0 - 5 * DAY, customerId: 'c1', siteId: 's1' },
    { id: 'o-new', number: 'ZL-2026-0107', status: 'new', createdAt: T0 - DAY, customerId: 'c2', siteId: 's2' },
    { id: 'o-odd', number: 'ZL-2026-0300', status: 'brand_new_status', createdAt: T0 - 8 * DAY, customerId: null, siteId: null },
  ],
  customers: [
    { id: 'c1', displayName: 'Jan Łódzki Synthetic' },
    { id: 'c2', displayName: 'Firma Testowa' },
  ],
  sites: [
    { id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' },
    { id: 's2', street: 'ul. Fikcyjna', buildingNumber: '12', city: 'Piaseczno', parkingSpot: '' },
  ],
  stages: [{ workOrderId: 'o-old', name: 'Zgłoszenie do OSD', position: 2, status: 'waiting' }],
};
const quickRecord = (): QueueRecord => ({
  mutationId: 'm-quick',
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  payload: {
    workOrderId: 'o-quick',
    title: 'SYNTHETIC-TITLE',
    newCustomer: { displayName: 'Zofia Świętosławska' },
    newSite: { street: 'ul. Nowa', buildingNumber: '3', city: 'Gdynia', parkingSpotNumber: 'B-12' },
  },
  objectId: 'o-quick',
  orderingKey: 'o-quick',
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
});
const noteRecord = (orderingKey: string): QueueRecord => ({
  mutationId: 'm-note',
  type: 'CreateNote',
  commandVersion: 1,
  payload: { id: 'n1', workOrderId: orderingKey, body: 'x' },
  objectId: 'n1',
  orderingKey,
  createdAt: T0,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
});
const ROWS: OrderRow[] = buildOrderList(SOURCE, [queueFact(quickRecord(), true), queueFact(noteRecord('o-old'), true)]);
const ROW_NEW: OrderRow =
  ROWS.find((r) => r.id === 'o-new') ??
  ROWS[0] ??
  (() => {
    throw new Error('fixture');
  })();

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const rigWith = (rows: OrderRow[] = ROWS): PortsRig => {
  const rig = stubPorts();
  rig.sync.rows = rows;
  return rig;
};
const shownIds = (): string[] =>
  screen.queryAllByTestId(/^order-row-/).map((node) => (node.props as { testID: string }).testID.replace('order-row-', ''));
const type = async (text: string) => {
  await fireEvent.changeText(screen.getByLabelText(pl.shell.orders.searchLabel), text);
  await settle();
};
const NAMES = /Łódzki|Żółkiewskiego|Łódź|Fikcyjna|Piaseczno|Świętosławska|Gdynia|B-12|Firma Testowa/;

describe('list from the local database (EVM-103 AC1)', () => {
  it('EVM-103 AC1: the list shows number, customer, address, place, status and stage of every work order, newest first, "Oczekuje na numer" on top', async () => {
    const rig = rigWith();
    await open(rig);
    expect(rig.sync.orderRequests).toContain(true);
    expect(shownIds()).toEqual(['o-quick', 'o-new', 'o-old', 'o-odd']);
    const old = screen.getByTestId('order-row-o-old');
    expect(within(old).getByText('ZL-2026-0042')).toBeOnTheScreen();
    expect(within(old).getByText('Jan Łódzki Synthetic')).toBeOnTheScreen();
    expect(within(old).getByText('ul. Żółkiewskiego 7, Łódź')).toBeOnTheScreen();
    expect(within(old).getByText('Miejsce 15')).toBeOnTheScreen();
    expect(within(old).getByText('Etap: Zgłoszenie do OSD')).toBeOnTheScreen();
    expect(within(old).getByText(pl.shell.orders.status.in_progress)).toBeOnTheScreen();
    expect(within(old).getByText(pl.shell.orders.unsent)).toBeOnTheScreen();
    expect(old).toHaveAccessibleName(
      'ZL-2026-0042, W realizacji, Jan Łódzki Synthetic, ul. Żółkiewskiego 7, Łódź, Miejsce 15, Etap: Zgłoszenie do OSD, Niewysłane',
    );
    // a status the app does not know is only the "Nieznany status" badge (styleguide § 3.9.1)
    expect(within(screen.getByTestId('order-row-o-odd')).getByText(pl.shell.orders.unknownStatus)).toBeOnTheScreen();
  });

  it('EVM-103 AC1: until the details exist (EVM-104) a row is one inactive block - no button role, not selectable, no action', async () => {
    await open(rigWith());
    const row = screen.getByTestId('order-row-o-old');
    expect(row.props).not.toHaveProperty('onPress');
    expect(row.props).not.toHaveProperty('onClick');
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.accessible).toBe(true);
    expect(within(screen.getByTestId('orders-list')).queryAllByRole('button')).toEqual([]);
    for (const node of within(row).queryAllByText(/./)) expect(node.props.selectable).toBeFalsy();
  });

  it('EVM-103 AC1: an unauthenticated user sees the sign-in, never the list (no read of the model)', async () => {
    const owner = stubOwner();
    owner.restoreResult = { kind: 'signed_out' };
    const rig = stubPorts(owner);
    rig.sync.rows = ROWS;
    await open(rig);
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
    expect(screen.queryByTestId('orders-list')).toBeNull();
    expect(rig.sync.orderRequests).toEqual([]);
    expect(whole()).not.toMatch(NAMES);
  });

  it('EVM-103 AC1: a refresh of the data replaces the rows without a skeleton in between; a work order that left the scope is gone at once', async () => {
    const rig = rigWith();
    await open(rig);
    expect(shownIds()).toContain('o-old');
    rig.sync.rows = ROWS.filter((r) => r.id !== 'o-old');
    await act(() => {
      rig.sync.set({ lastSuccessAt: T0 });
    });
    await settle();
    expect(shownIds()).toEqual(['o-quick', 'o-new', 'o-odd']);
    expect(screen.queryByTestId('orders-skeleton')).toBeNull();
    await type('0042');
    expect(shownIds()).toEqual([]);
    expect(screen.getByTestId('orders-no-match')).toBeOnTheScreen();
  });

  it('EVM-103 AC1: a failing read leaves an empty (not a broken) list', async () => {
    const rig = rigWith();
    rig.sync.orderListHook = () => Promise.reject(new Error('read failed (synthetic)'));
    await open(rig);
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
  });
});

describe('search (EVM-103 AC2)', () => {
  it('EVM-103 AC2: from one character, as you type, by number, customer, street and place, without case and Polish diacritics ("lodz" finds "Łódź")', async () => {
    await open(rigWith());
    await type('l');
    expect(shownIds()).toContain('o-old');
    expect(shownIds()[0]).toBe('o-quick');
    await type('lodz');
    expect(shownIds()).toEqual(['o-old']);
    await type('ŻÓŁKIEWSKIEGO');
    expect(shownIds()).toEqual(['o-old']);
    await type('0107');
    expect(shownIds()).toEqual(['o-new']);
    await type('B-12');
    expect(shownIds()).toEqual(['o-quick']);
    await type('swietoslawska');
    expect(shownIds()).toEqual(['o-quick']);
    await type('15');
    expect(shownIds()).toContain('o-old');
  });

  it('EVM-103 AC2: offline the search works the same (the list is local)', async () => {
    const rig = rigWith();
    rig.sync.set({ online: false });
    await open(rig, offline);
    await type('piaseczno');
    expect(shownIds()).toEqual(['o-new']);
  });

  it('EVM-103 AC2: special characters never fail and match literally; the field keeps what was typed', async () => {
    await open(rigWith());
    for (const special of ['%', '_', '*', '(', ')', "'", '"', '\\', '[', ']', '^', '$', '|', '?', '😀', '(a+)+$']) {
      await type(special);
      expect(shownIds()).toEqual([]);
      expect(screen.getByTestId('orders-no-match')).toBeOnTheScreen();
      expect(screen.getByLabelText(pl.shell.orders.searchLabel).props.value).toBe(special);
    }
    // "ul." is part of the text: a dot is a dot, not "any character"
    await type('ul.');
    expect(shownIds().sort()).toEqual(['o-new', 'o-old', 'o-quick']);
    await type('u.');
    expect(shownIds()).toEqual([]);
  });

  it('EVM-103 AC2: "Wyczyść wyszukiwanie" (field and state) brings back the whole list and is not offered for an empty field', async () => {
    await open(rigWith());
    expect(screen.queryByTestId('orders-search-clear')).toBeNull();
    await type('lodz');
    expect(shownIds()).toEqual(['o-old']);
    await fireEvent.press(screen.getByRole('button', { name: pl.shell.orders.clearSearch }));
    await settle();
    expect(shownIds()).toEqual(['o-quick', 'o-new', 'o-old', 'o-odd']);
    expect(screen.getByLabelText(pl.shell.orders.searchLabel).props.value).toBe('');
  });

  it('EVM-103 AC2: the count is announced politely only after the typing has stopped ("1 wynik", "Brak wyników", plural forms)', async () => {
    jest.useFakeTimers();
    try {
      await open(rigWith());
      await type('l');
      expect(screen.queryByTestId('orders-results-count')).toBeNull();
      await act(() => {
        jest.advanceTimersByTime(ANNOUNCE_AFTER_MS + 10);
      });
      const live = screen.getByTestId('orders-results-count');
      expect(live.props.accessibilityLiveRegion).toBe('polite');
      expect(live).toHaveTextContent(/wyniki|wyników|wynik/);
      await type('lodz');
      await act(() => {
        jest.advanceTimersByTime(ANNOUNCE_AFTER_MS + 10);
      });
      expect(screen.getByTestId('orders-results-count')).toHaveTextContent('1 wynik');
      await type('zzzz');
      await act(() => {
        jest.advanceTimersByTime(ANNOUNCE_AFTER_MS + 10);
      });
      expect(screen.getByTestId('orders-results-count')).toHaveTextContent(pl.shell.orders.noResults);
      // the announcement carries numbers only, never a name
      expect(JSON.stringify(screen.getByTestId('orders-results-count').props)).not.toMatch(NAMES);
      await type('');
      expect(screen.queryByTestId('orders-results-count')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-103 AC2: the plural forms of the count follow Polish rules', async () => {
    jest.useFakeTimers();
    try {
      const many: OrderRow[] = Array.from({ length: 12 }, (_, n) => ({
        ...ROW_NEW,
        id: `r-${String(n)}`,
        number: `ZL-${String(n)}`,
        keys: { number: `zl-${String(n)}`, address: 'x', customer: 'x' },
        awaitingNumber: false,
      }));
      await open(rigWith(many));
      for (const [q, text] of [
        ['zl-1', '3 wyniki'],
        ['zl-', '12 wyników'],
        ['zl-5', '1 wynik'],
      ] as const) {
        await type(q);
        await act(() => {
          jest.advanceTimersByTime(ANNOUNCE_AFTER_MS + 10);
        });
        // "zl-1" matches zl-1, zl-10, zl-11
        expect(screen.getByTestId('orders-results-count')).toHaveTextContent(text);
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('chips and waiting work orders (EVM-103 AC3)', () => {
  it('EVM-103 AC3: "Niewysłane (n)" counts every work order with elements in the queue, whatever the query; the chips are toggles with a state', async () => {
    await open(rigWith());
    const all = screen.getByTestId('orders-chip-all');
    const unsent = screen.getByTestId('orders-chip-unsent');
    expect(within(unsent).getByText('Niewysłane (2)')).toBeOnTheScreen();
    expect(all).toHaveAccessibleName('Wszystkie zlecenia, wybrane');
    expect(unsent).toHaveAccessibleName('Niewysłane, 2 zlecenia');
    expect(all.props.accessibilityState).toMatchObject({ selected: true });
    await type('piaseczno');
    expect(within(screen.getByTestId('orders-chip-unsent')).getByText('Niewysłane (2)')).toBeOnTheScreen();
    await type('');
    await fireEvent.press(screen.getByTestId('orders-chip-unsent'));
    await settle();
    expect(shownIds()).toEqual(['o-quick', 'o-old']);
    expect(screen.getByTestId('orders-chip-unsent')).toHaveAccessibleName('Niewysłane, 2 zlecenia, wybrane');
    expect(screen.getByTestId('orders-chip-unsent').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('orders-chip-all').props.accessibilityState).toMatchObject({ selected: false });
    // the chip works together with the query
    await type('lodz');
    expect(shownIds()).toEqual(['o-old']);
    await type('piaseczno');
    expect(shownIds()).toEqual([]);
    expect(screen.getByTestId('orders-no-match')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('orders-chip-all'));
    await settle();
    expect(shownIds()).toEqual(['o-new']);
  });

  it('EVM-103 AC3: the plural name of the chip: one work order, many work orders', async () => {
    const one = ROWS.filter((r) => r.id !== 'o-old');
    await open(rigWith(one));
    expect(screen.getByTestId('orders-chip-unsent')).toHaveAccessibleName('Niewysłane, 1 zlecenie');
  });

  it('EVM-103 AC3: an empty chip says "Wszystko wysłane."', async () => {
    await open(rigWith(ROWS.map((r) => ({ ...r, unsent: false }))));
    await fireEvent.press(screen.getByTestId('orders-chip-unsent'));
    await settle();
    expect(screen.getByTestId('orders-all-sent')).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.allSent)).toBeOnTheScreen();
    expect(within(screen.getByTestId('orders-chip-unsent')).getByText('Niewysłane (0)')).toBeOnTheScreen();
  });

  it('EVM-103 AC3: a work order waiting for its number is marked with an icon and text, stays on top, and is found by address and customer', async () => {
    await open(rigWith());
    const waiting = screen.getByTestId('order-row-o-quick');
    expect(within(waiting).getByText(pl.shell.orders.awaitingNumber)).toBeOnTheScreen();
    expect(screen.getByTestId('order-awaiting-o-quick')).toBeOnTheScreen();
    expect(waiting).toHaveAccessibleName(`${pl.shell.orders.awaitingNumber}, Zofia Świętosławska, ul. Nowa 3, Gdynia, Miejsce B-12`);
    expect(shownIds()[0]).toBe('o-quick');
    await type('gdynia');
    expect(shownIds()).toEqual(['o-quick']);
    await type('swietoslawska');
    expect(shownIds()).toEqual(['o-quick']);
    // on top also among the results
    await type('ul.');
    expect(shownIds()[0]).toBe('o-quick');
  });
});

describe('empty states (EVM-103 AC4)', () => {
  it('EVM-103 AC4: no work orders - "Nie masz zleceń w telefonie…" with "Nowe zlecenie"; no field, no chips', async () => {
    const rig = rigWith([]);
    await open(rig);
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: pl.shell.orders.emptyTitle })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.emptyBody)).toBeOnTheScreen();
    expect(screen.queryByLabelText(pl.shell.orders.searchLabel)).toBeNull();
    expect(screen.queryByTestId('orders-chip-all')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-empty-new'));
    expect(screen.getByTestId('add-sheet')).toBeOnTheScreen();
  });

  it('EVM-103 AC4: offline an empty list also says "Brak zasięgu."', async () => {
    const rig = rigWith([]);
    rig.sync.set({ online: false });
    await open(rig, offline);
    expect(screen.getByText(`${pl.shell.orders.offlineNote} ${pl.shell.orders.emptyBody}`)).toBeOnTheScreen();
  });

  it('EVM-103 AC4: no results - the phrase stays in the field, "Szukamy tylko w zleceniach zapisanych w telefonie" and "Wyczyść wyszukiwanie"; online with fresh data no time line', async () => {
    const rig = rigWith();
    rig.sync.set({ lastSuccessAt: Date.now() - 5 * MIN });
    await open(rig);
    await type('kowalski');
    expect(screen.getByText('Brak zleceń dla „kowalski”')).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.noMatchBody)).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.shell.orders.searchLabel).props.value).toBe('kowalski');
    expect(screen.queryByTestId('orders-last-sync')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-clear-search'));
    await settle();
    expect(shownIds()).toHaveLength(4);
  });

  it('EVM-103 AC4: no results offline - the time of the last synchronization, "Synchronizuj" disabled with the visible text "Wymaga połączenia"', async () => {
    const rig = rigWith();
    rig.sync.set({ online: false, lastSuccessAt: Date.now() - 2 * 3_600_000 });
    await open(rig, offline);
    await type('kowalski');
    const line = screen.getByTestId('orders-last-sync');
    expect(
      within(line).getByText(/Ostatnia synchronizacja: .*Zlecenia założone w biurze później pojawią się po synchronizacji\./),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('orders-sync-now')).toBeDisabled();
    expect(screen.getByTestId('orders-sync-needs-connection')).toHaveTextContent(pl.shell.orders.needsConnection);
    // an unknown time of the last synchronization does not break the line
    await act(() => {
      rig.sync.set({ lastSuccessAt: null });
    });
    expect(within(screen.getByTestId('orders-last-sync')).getByText(pl.shell.orders.lastSyncUnknown)).toBeOnTheScreen();
  });

  it('EVM-103 AC4: no results with data older than 1 h while online - the time and an enabled "Synchronizuj" that starts a cycle; "dziś" for today', async () => {
    const rig = rigWith();
    const now = Date.now();
    rig.sync.set({ lastSuccessAt: now - 90 * MIN });
    await open(rig);
    await type('kowalski');
    expect(screen.getByTestId('orders-sync-now')).toBeEnabled();
    expect(screen.queryByTestId('orders-sync-needs-connection')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-sync-now'));
    expect(rig.sync.calls).toContain('trigger');
    // an older day shows the date
    await act(() => {
      rig.sync.set({ lastSuccessAt: now - 3 * DAY });
    });
    expect(screen.getByTestId('orders-last-sync')).toHaveTextContent(/Ostatnia synchronizacja: \d{2}\.\d{2}\.\d{4}, /);
  });

  it('EVM-103 AC4: during a refresh of the replica the list stays, with the banner "Odświeżamy dane zleceń…" - no skeleton', async () => {
    const rig = rigWith();
    await open(rig);
    await act(() => {
      rig.sync.set({ resyncing: true });
    });
    expect(screen.getByTestId('sync-notice-resync')).toBeOnTheScreen();
    expect(shownIds()).toHaveLength(4);
    expect(screen.queryByTestId('orders-skeleton')).toBeNull();
  });

  it('EVM-103 AC4: the first download shows M-12, not the list', async () => {
    const rig = rigWith();
    rig.sync.set({ initialLoad: 'loading', firstPull: { ...INITIAL_FIRST_PULL, received: 3 } });
    await open(rig);
    expect(screen.getByTestId('first-pull')).toBeOnTheScreen();
    expect(screen.queryByTestId('orders-list')).toBeNull();
    expect(rig.sync.orderRequests).toEqual([]);
  });

  it('EVM-103 AC4: with local rows the list is there at once while the first check hangs (offline-first); the slow note appears above it', async () => {
    jest.useFakeTimers();
    try {
      const rig = rigWith();
      await render(
        <App
          session={rig.session}
          checker={() => new Promise(() => undefined)}
          storage={() => ({ prepare: () => Promise.resolve('ready' as const) })}
        />,
      );
      await settle();
      expect(shownIds()).toHaveLength(4);
      expect(screen.queryByTestId('orders-skeleton')).toBeNull();
      expect(screen.queryByTestId('orders-slow')).toBeNull();
      await act(() => {
        jest.advanceTimersByTime(SLOW_CHECK_MS);
      });
      expect(screen.getByTestId('orders-slow')).toHaveTextContent(pl.shell.loading.slow);
      expect(shownIds()).toHaveLength(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-103 AC4: while the first check runs and nothing is local yet the skeleton shows; with local rows the list is there at once', async () => {
    const rig = rigWith([]);
    await render(
      <App
        session={rig.session}
        checker={() => new Promise(() => undefined)}
        storage={() => ({ prepare: () => Promise.resolve('ready' as const) })}
      />,
    );
    await settle();
    expect(screen.getByTestId('orders-skeleton')).toBeOnTheScreen();
  });
});

describe('hidden-data mode (EVM-103 AC5)', () => {
  it('EVM-103 AC5: opened in the mode - no field, no chips, no names, addresses or places anywhere; the model is read without data', async () => {
    const rig = rigWith();
    rig.device.facts.secure = false;
    await open(rig);
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    expect(screen.queryByLabelText(pl.shell.orders.searchLabel)).toBeNull();
    expect(screen.queryByTestId('orders-chip-all')).toBeNull();
    expect(screen.queryByTestId('orders-list')).toBeNull();
    expect(whole()).not.toMatch(NAMES);
    expect(whole()).not.toContain('Zgłoszenie do OSD');
    expect(rig.sync.orderRequests.length).toBeGreaterThan(0);
    expect(rig.sync.orderRequests.every((withData) => !withData)).toBe(true);
    // the action of EVM-101 stays
    expect(screen.getByTestId('hidden-action')).toBeOnTheScreen();
  });

  it('EVM-103 AC5: the mode starts while a query is typed - the query is zeroed at once, nothing filters, and after the data come back the list starts without it', async () => {
    const rig = rigWith();
    await open(rig);
    await type('lodz');
    expect(shownIds()).toEqual(['o-old']);
    await fireEvent.press(screen.getByTestId('orders-chip-unsent'));
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    expect(screen.queryByLabelText(pl.shell.orders.searchLabel)).toBeNull();
    expect(whole()).not.toMatch(NAMES);
    expect(whole()).not.toContain('lodz');
    rig.device.facts.secure = true;
    await fireEvent.press(screen.getByTestId('hidden-action'));
    await settle();
    const field = screen.getByLabelText(pl.shell.orders.searchLabel);
    expect(field.props.value).toBe('');
    expect(screen.getByTestId('orders-chip-all').props.accessibilityState).toMatchObject({ selected: true });
    expect(shownIds()).toEqual(['o-quick', 'o-new', 'o-old', 'o-odd']);
    expect(rig.sync.orderRequests.at(-1)).toBe(true);
  });

  it('EVM-103 AC5: a late answer of a read WITH data that arrives after the mode started is dropped (race "read in flight -> hidden -> answer")', async () => {
    const rig = rigWith();
    let release: (rows: readonly OrderRow[]) => void = () => undefined;
    const late = new Promise<readonly OrderRow[]>((resolve) => {
      release = resolve;
    });
    let first = true;
    rig.sync.orderListHook = (withData) => {
      if (withData && first) {
        first = false;
        return late;
      }
      return Promise.resolve(withData ? ROWS : ROWS.map((r) => ({ ...r, customer: '', street: '', city: '', spot: '', stage: '' })));
    };
    await open(rig);
    expect(rig.sync.orderRequests).toEqual([true]);
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    await act(async () => {
      release(ROWS);
      await Promise.resolve();
    });
    await settle();
    expect(whole()).not.toMatch(NAMES);
    // back from the mode: the stale rows of the old answer are not on the screen either
    rig.device.facts.secure = true;
    await fireEvent.press(screen.getByTestId('hidden-action'));
    await settle();
    expect(shownIds()).toHaveLength(4);
  });

  it('EVM-103 AC5: while the mode is being checked ("checking") the data stay hidden too (fail-closed)', async () => {
    const rig = rigWith();
    rig.device.facts.secure = 'throws';
    await open(rig);
    // an unreadable lock state is the hidden mode, never "visible"
    expect(whole()).not.toMatch(NAMES);
    expect(screen.queryByLabelText(pl.shell.orders.searchLabel)).toBeNull();
  });

  it('EVM-103 AC5: leaving the screen drops the query (a new visit starts empty); sign-out leaves no list', async () => {
    const rig = rigWith();
    await open(rig);
    await type('lodz');
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.orders.title }));
    await settle();
    expect(screen.getByLabelText(pl.shell.orders.searchLabel).props.value).toBe('');
    expect(shownIds()).toHaveLength(4);
    await act(() => {
      rig.owner.end({ reason: 'signed_out', unsentItems: 0 });
    });
    await settle();
    expect(screen.queryByTestId('orders-list')).toBeNull();
    expect(whole()).not.toMatch(NAMES);
  });
});

describe('scope and no sensitive data (EVM-103 AC6)', () => {
  it('EVM-103 AC6: the search field switches off autocorrect, spell check, autofill and suggestions with the standard properties, limits the length and shows the label', async () => {
    await open(rigWith());
    const field = screen.getByLabelText(pl.shell.orders.searchLabel);
    expect(field.props).toMatchObject({
      autoCorrect: false,
      spellCheck: false,
      autoComplete: 'off',
      importantForAutofill: 'no',
      textContentType: 'none',
      autoCapitalize: 'none',
      returnKeyType: 'search',
      maxLength: SEARCH_MAX_LENGTH,
      accessibilityLabel: pl.shell.orders.searchLabel,
    });
    expect(field.props.secureTextEntry).toBeFalsy();
  });

  it('EVM-103 AC6: the clear button and the chips have targets of at least 48 dp; the chips are at least 8 dp apart', async () => {
    await open(rigWith());
    await type('x');
    const flat = (node: { props: { style?: unknown } }): Record<string, number> =>
      Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, number>;
    const clear = screen.getByTestId('orders-search-clear');
    expect(flat(clear).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(clear).minWidth).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByTestId('orders-chip-all')).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByTestId('orders-chip-unsent')).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(screen.getByLabelText(pl.shell.orders.filterLabel)).gap).toBeGreaterThanOrEqual(8);
  });

  it('EVM-103 AC6: the list holds only what the replica projection gives - no payment, price or amount', async () => {
    await open(rigWith());
    const listed = within(screen.getByTestId('orders-list'))
      .queryAllByText(/./)
      .map((node) => String((node.props as { children?: unknown }).children))
      .join(' | ');
    expect(listed).toContain('ZL-2026-0042');
    expect(listed).not.toMatch(/zł|PLN|płatno|faktur|brutto|netto/i);
  });

  it('EVM-103 AC6: the query is only a local state - no logger, console, storage, navigation parameter or restored state in the list code', () => {
    const read = (name: string): string => readFileSync(join(__dirname, '..', 'src', 'screens', name), 'utf8');
    for (const name of ['OrdersScreen.tsx', 'orders-hooks.ts', 'OrderCard.tsx']) {
      const source = read(name);
      expect(source).not.toMatch(
        /console\.|logWarning|logging\/log|AsyncStorage|SecureStore|setParams|navigate\(|useNavigation|persist|localStorage/,
      );
    }
    const screenSource = read('OrdersScreen.tsx');
    expect([...screenSource.matchAll(/useState\(''\)/g)]).toHaveLength(1);
    const panel = readFileSync(join(__dirname, '..', 'src', 'e2e-hooks', 'panel.tsx'), 'utf8');
    expect(panel).not.toMatch(/orderList|useOrderList|OrdersScreen|order-list-model/);
    for (const name of ['order-list-model.ts', 'normalize.ts']) {
      const source = readFileSync(join(__dirname, '..', 'src', 'orders', name), 'utf8');
      expect(source).not.toMatch(/new RegExp\(|RegExp\(|\.match\(|\.test\(|\.search\(|\bconsole\./);
    }
  });

  it('EVM-103 AC6: neither the query nor a name reaches the console during typing, sorting and clearing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      await open(rigWith());
      await type('SYNTHETIC-QUERY-lodz');
      await type('lodz');
      await fireEvent.press(screen.getByTestId('orders-chip-unsent'));
      await settle();
      await fireEvent.press(screen.getByTestId('orders-chip-all'));
      await fireEvent.press(screen.getByRole('button', { name: pl.shell.orders.clearSearch }));
      await settle();
      const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
      expect(logged).not.toContain('SYNTHETIC-QUERY');
      expect(logged).not.toMatch(NAMES);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-103 AC6: names are rendered as text - markup in a name is shown as it is, nothing is interpreted', async () => {
    const rows = [
      { ...ROW_NEW, customer: '<b>Jan</b> <script>x</script> $t(shell.orders.title)', keys: { number: '', address: '', customer: '' } },
    ];
    await open(rigWith(rows));
    expect(screen.getByText('<b>Jan</b> <script>x</script> $t(shell.orders.title)')).toBeOnTheScreen();
    expect(screen.queryByText('<b>Jan</b>')).toBeNull();
  });
});
