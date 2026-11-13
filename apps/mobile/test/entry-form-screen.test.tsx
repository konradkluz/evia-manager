import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, TextInput } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { buildOrderList, type OrderListSource, type OrderRow } from '../src/orders/order-list-model';
import type { OrderDetail } from '../src/orders/order-detail-model';
import { type StartupChecker } from '../src/startup';
import { size } from '../src/ui/theme';
import { stubPorts, type PortsRig } from './session-helpers';

// EVM-105 AC1-AC4 (+ security 1-8): the entry form on the phone - written into the durable queue, never anywhere else.
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
/** Texts, labels, hints, placeholders, values and test ids of a rendered node (the test rig itself is never part of it). */
const collect = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === 'string') out.push(node);
  if (typeof node !== 'object' || node === null) return out;
  const json = node as { props?: Record<string, unknown>; children?: unknown[] };
  for (const key of ['accessibilityLabel', 'accessibilityHint', 'testID', 'value', 'placeholder'] as const) {
    const value = json.props?.[key];
    if (typeof value === 'string') out.push(value);
  }
  for (const child of json.children ?? []) collect(child, out);
  return out;
};
const whole = (): string => collect(screen.toJSON()).join(' | ');
/** The same under one test id. */
const treeOf = (testID: string): string => {
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
  return collect(find(screen.toJSON())).join(' | ');
};
const flat = (node: { props: { style?: unknown } }): Record<string, number> =>
  Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, number>;

const SOURCE: OrderListSource = {
  orders: [
    { id: 'o1', number: 'ZL-2026-0042', status: 'in_progress', createdAt: 1, customerId: 'c1', siteId: 's1' },
    { id: 'o2', number: 'ZL-2026-0043', status: 'settled', createdAt: 2, customerId: 'c1', siteId: 's1' },
  ],
  customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
  sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
  stages: [],
};
const ROWS: OrderRow[] = buildOrderList(SOURCE, []);
const DETAIL: OrderDetail = {
  id: 'o1',
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { name: 'Jan Łódzki Synthetic', phone: '+48 600 100 200', dial: '+48600100200' },
  location: { street: 'ul. Żółkiewskiego 7', city: '00-001 Łódź', spot: '15', level: '-1', powerKw: '40', operator: null, manager: null },
  scope: [],
  processes: [
    {
      id: 'p1',
      name: 'Przyłączenie OSD',
      stages: [
        { id: 'st1', name: 'Wniosek do OSD', status: 'done', waitingFor: null },
        { id: 'st2', name: 'Umowa', status: 'todo', waitingFor: null },
      ],
    },
  ],
  journal: [],
};
const DETAIL_2: OrderDetail = { ...DETAIL, id: 'o2', number: 'ZL-2026-0043', title: 'Rozliczone', status: 'settled', processes: [] };
const PERSONAL = /Łódzki|Żółkiewskiego|Łódź|600 100 200|600100200/;
const MARKER = 'SYNTHETIC-MARKER-Zażółć-gęślą';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function open(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const rigWith = (): PortsRig => {
  const rig = stubPorts();
  rig.sync.rows = ROWS;
  rig.sync.details.set('o1', DETAIL);
  rig.sync.details.set('o2', DETAIL_2);
  rig.sync.targets = [
    { id: 'o1', number: 'ZL-2026-0042', title: 'Garaż — pełny proces' },
    { id: 'o2', number: 'ZL-2026-0043', title: 'Rozliczone' },
  ];
  return rig;
};
/** M-03 -> "Dodaj wpis". */
const openForm = async (rig: PortsRig, order = 'o1') => {
  await open(rig);
  await fireEvent.press(screen.getByTestId(`order-row-${order}`));
  await settle();
  await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
  await settle();
};
const type = async (value: string) => {
  await fireEvent.changeText(screen.getByTestId('entry-body'), value);
};
const save = async () => {
  await fireEvent.press(screen.getByTestId('entry-save'));
  await settle();
};
const hide = async (rig: PortsRig) => {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};

let announce: jest.SpyInstance;
let focus: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  focus = jest.spyOn(TextInput.prototype as unknown as { focus: () => void }, 'focus').mockImplementation(() => undefined);
});
afterEach(() => {
  announce.mockRestore();
  focus.mockRestore();
});

describe('note offline (EVM-105 AC1)', () => {
  it('EVM-105 AC1: "Dodaj wpis" in M-03 opens the form of THIS order; "Wpis" and "Inne" are chosen by default', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.getByTestId('entry-form')).toBeOnTheScreen();
    expect(within(screen.getByTestId('entry-order')).getByText('ZL-2026-0042 · Garaż — pełny proces')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-kind-note').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('entry-category-other').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId('entry-category-meeting').props.accessibilityState).toMatchObject({ checked: false });
    // the categories of the story, in the radio group "Kategoria"
    for (const label of ['Rozmowa telefoniczna', 'Spotkanie', 'Ustalenie', 'Wizyta na miejscu', 'Inne']) {
      expect(within(screen.getByTestId('entry-categories')).getByText(label)).toBeOnTheScreen();
    }
    expect(screen.getByTestId('entry-categories').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByTestId('entry-categories').props.accessibilityLabel).toBe('Kategoria');
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-105 AC1: saving gives CreateNote v1 with category, stage of this order, text and the time on the phone; the form closes, the toast is shown and announced', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('entry-category-site_visit'));
    await fireEvent.press(screen.getByTestId('entry-stage'));
    await fireEvent.press(screen.getByTestId('entry-stage-st2'));
    expect(within(screen.getByTestId('entry-stage')).getByText('Umowa')).toBeOnTheScreen();
    await type('  Trasa kabla przez szacht B.  ');
    const before = Date.now();
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    const [input] = rig.sync.enqueued;
    expect(input).toMatchObject({ type: 'CreateNote', commandVersion: 1 });
    const payload = input?.payload as Record<string, string>;
    expect(payload).toMatchObject({
      workOrderId: 'o1',
      noteCategory: 'site_visit',
      procedureStageId: 'st2',
      body: 'Trasa kabla przez szacht B.',
    });
    expect(payload['id']).toMatch(UUID_V7);
    expect(Date.parse(payload['capturedAt'] ?? '')).toBeGreaterThanOrEqual(before - 1000);
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    expect(within(screen.getByTestId('entry-toast')).getByText(pl.entryForm.saved)).toBeOnTheScreen();
    expect(pl.entryForm.saved).toBe('Zapisano w telefonie. Wyślemy, gdy wróci zasięg.');
    expect(announce).toHaveBeenCalledWith(pl.entryForm.saved);
  });

  it('EVM-105 AC1: the form closes only AFTER the queue confirmed the write (the file is durable before the user is told)', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await type('Treść oczekuje na zapis');
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    // not confirmed yet: the form, the text, no toast, no announcement
    expect(screen.getByTestId('entry-form')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-body').props.value).toBe('Treść oczekuje na zapis');
    expect(screen.queryByTestId('entry-toast')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(screen.getByTestId('entry-toast')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('EVM-105 AC1: one touch = one mutation - a second touch before the answer adds nothing, the button is busy and the field is locked', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await type('Dwa dotknięcia');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await fireEvent.press(screen.getByTestId('entry-save'));
    await fireEvent.press(screen.getByTestId('entry-save'));
    await settle();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(screen.getByTestId('entry-save').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.getByTestId('entry-body').props.editable).toBe(false);
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(rig.sync.enqueued).toHaveLength(1);
  });

  it('EVM-105 AC1: every save takes a new UUIDv7 - two entries never share an id, and the id is not the mutation of a failed try', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('Pierwszy');
    await save();
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByTestId('entry-body').props.value).toBe('');
    await type('Drugi');
    await save();
    const ids = rig.sync.enqueued.map((input) => (input.payload as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(UUID_V7);
  });

  it('EVM-105 AC1: a settled order takes entries too (no gate on the status)', async () => {
    const rig = rigWith();
    await openForm(rig, 'o2');
    expect(within(screen.getByTestId('entry-order')).getByText('ZL-2026-0043 · Rozliczone')).toBeOnTheScreen();
    await type('Wpis do rozliczonego');
    await save();
    expect(rig.sync.enqueued[0]?.payload).toMatchObject({ workOrderId: 'o2', body: 'Wpis do rozliczonego' });
  });

  it('EVM-105 AC1: "Bez etapu" clears a chosen stage and an order without stages still takes an entry', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('entry-stage'));
    await fireEvent.press(screen.getByTestId('entry-stage-st1'));
    await fireEvent.press(screen.getByTestId('entry-stage'));
    await fireEvent.press(screen.getByTestId('entry-stage-none'));
    await type('Bez etapu');
    await save();
    expect(Object.keys(rig.sync.enqueued[0]?.payload as object)).not.toContain('procedureStageId');
  });

  it('EVM-105 AC1: the stage list can be dismissed and shows the stages of this order only', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('entry-stage'));
    const dialog = treeOf('entry-stage-dialog');
    expect(dialog).toContain('Wniosek do OSD');
    expect(dialog).toContain('Umowa');
    await fireEvent.press(screen.getByTestId('entry-stage-cancel'));
    expect(screen.queryByTestId('entry-stage-dialog')).toBeNull();
  });

  it('EVM-105 AC1: with several processes the stage choice names the process', async () => {
    const rig = rigWith();
    rig.sync.details.set('o1', {
      ...DETAIL,
      processes: [
        ...DETAIL.processes,
        { id: 'p2', name: 'Montaż', stages: [{ id: 'st9', name: 'Odbiór', status: 'todo', waitingFor: null }] },
      ],
    });
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('entry-stage'));
    expect(treeOf('entry-stage-st9')).toContain('Montaż · Odbiór');
  });
});

describe('comment (EVM-105 AC2)', () => {
  it('EVM-105 AC2: "Komentarz" hides the category and the stage and saves CreateComment without them', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('entry-category-meeting'));
    await fireEvent.press(screen.getByTestId('entry-stage'));
    await fireEvent.press(screen.getByTestId('entry-stage-st1'));
    await fireEvent.press(screen.getByTestId('entry-kind-comment'));
    expect(screen.getByTestId('entry-kind-comment').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId('entry-categories')).toBeNull();
    expect(screen.queryByTestId('entry-stage')).toBeNull();
    await type('Komentarz z terenu');
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(rig.sync.enqueued[0]).toMatchObject({ type: 'CreateComment', commandVersion: 1 });
    expect(Object.keys(rig.sync.enqueued[0]?.payload as object).sort()).toEqual(['body', 'capturedAt', 'id', 'workOrderId']);
    expect(announce).toHaveBeenCalledWith(pl.entryForm.saved);
    expect(screen.getByTestId('entry-toast')).toBeOnTheScreen();
  });

  it('EVM-105 AC2: the typed text is kept when the kind is switched back and forth', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('Zostaje');
    await fireEvent.press(screen.getByTestId('entry-kind-comment'));
    await fireEvent.press(screen.getByTestId('entry-kind-note'));
    expect(screen.getByTestId('entry-body').props.value).toBe('Zostaje');
  });
});

describe('validation (EVM-105 AC3)', () => {
  it('EVM-105 AC3: an empty text (white space only) gives "Wpisz treść wpisu." at the field, the focus goes to the field and nothing is queued', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('   \n\t ');
    await save();
    expect(within(screen.getByTestId('entry-form')).getByText('Wpisz treść wpisu.')).toBeOnTheScreen();
    expect(focus).toHaveBeenCalled();
    expect(rig.sync.enqueued).toEqual([]);
    expect(screen.getByTestId('entry-form')).toBeOnTheScreen();
    expect(screen.queryByTestId('entry-toast')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('EVM-105 AC3: a text over 10 000 characters gives the limit message, nothing is queued and the text stays; 10 000 are accepted', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('a'.repeat(10_001));
    await save();
    expect(
      within(screen.getByTestId('entry-form')).getByText('Treść jest za długa. Wpis może mieć najwyżej 10000 znaków.'),
    ).toBeOnTheScreen();
    expect(rig.sync.enqueued).toEqual([]);
    expect(screen.getByTestId('entry-body').props.value).toHaveLength(10_001);
    // no silent cut: the field has no maxLength
    expect(screen.getByTestId('entry-body').props.maxLength).toBeUndefined();
    await type('a'.repeat(10_000));
    expect(screen.queryByText(/za długa/)).toBeNull();
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
  });

  it('EVM-105 AC3: a text with a lone surrogate gets its own message at the field', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('abc\ud800');
    await save();
    expect(screen.getByText(pl.entryForm.errors.invalid)).toBeOnTheScreen();
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-105 AC3: the error disappears when the user types, and the fixed hint about PESEL is always there', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeOnTheScreen();
    await save();
    expect(screen.getByTestId('entry-body-error')).toBeOnTheScreen();
    await type('x');
    expect(screen.queryByTestId('entry-body-error')).toBeNull();
    expect(screen.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeOnTheScreen();
  });
});

describe('save failures keep the text (EVM-105 AC1, security 2)', () => {
  const failures: readonly [string, string][] = [
    ['storage_failure', pl.entryForm.errors.storage],
    ['payload_too_large', pl.entryForm.errors.too_large],
    ['no_session', pl.entryForm.errors.failed],
    ['invalid_input', pl.entryForm.errors.failed],
  ];
  it.each(failures)(
    'EVM-105 AC1: the code %s - the text stays, the form stays, nothing is announced, the message has no text',
    async (code, message) => {
      const rig = rigWith();
      rig.sync.result = { ok: false, code };
      await openForm(rig);
      await type(MARKER);
      await save();
      expect(within(screen.getByTestId('entry-alert')).getByText(message)).toBeOnTheScreen();
      expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
      expect(screen.getByTestId('entry-form')).toBeOnTheScreen();
      expect(screen.queryByTestId('entry-toast')).toBeNull();
      expect(announce).not.toHaveBeenCalled();
      expect(treeOf('entry-alert')).not.toContain(MARKER);
      // the button is free again: the next touch tries again
      rig.sync.result = { ok: true };
      await save();
      expect(rig.sync.enqueued).toHaveLength(2);
      expect(screen.queryByTestId('entry-form')).toBeNull();
    },
  );

  it('EVM-105 AC1: "Brak miejsca w telefonie. Zwolnij miejsce — wpis zostaje w formularzu."', () => {
    expect(pl.entryForm.errors.storage).toBe('Brak miejsca w telefonie. Zwolnij miejsce — wpis zostaje w formularzu.');
  });

  it('EVM-105 AC1: a call of the queue that throws is the general message and the text stays', async () => {
    const rig = rigWith();
    rig.sync.enqueueHook = () => Promise.reject(new Error(`boom ${MARKER}`));
    await openForm(rig);
    await type(MARKER);
    await save();
    expect(screen.getByText(pl.entryForm.errors.failed)).toBeOnTheScreen();
    expect(whole()).not.toContain('boom');
    expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
  });
});

describe('entries and the target (EVM-105 AC4)', () => {
  it('EVM-105 AC4: "Dodaj" -> "Wpis" first asks for the order: number and title only, no customer, phone or address', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    expect(rig.sync.calls).toContain('options:null');
    const picker = treeOf('entry-picker');
    expect(picker).toContain('ZL-2026-0042 · Garaż — pełny proces');
    expect(picker).toContain('ZL-2026-0043 · Rozliczone');
    expect(picker).not.toMatch(PERSONAL);
    expect(rig.opened).not.toContain('add:entry');
    await fireEvent.press(screen.getByTestId('entry-picker-o2'));
    await settle();
    expect(screen.queryByTestId('entry-picker')).toBeNull();
    expect(within(screen.getByTestId('entry-order')).getByText('ZL-2026-0043 · Rozliczone')).toBeOnTheScreen();
    await type('Z wyboru zlecenia');
    await save();
    expect(rig.sync.enqueued[0]?.payload).toMatchObject({ workOrderId: 'o2' });
  });

  it('EVM-105 AC4: without orders on the phone the picker says so instead of a list', async () => {
    const rig = rigWith();
    rig.sync.targets = [];
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    expect(within(screen.getByTestId('entry-picker')).getByText(pl.entryForm.picker.empty)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('entry-picker-cancel'));
    expect(screen.queryByTestId('entry-picker')).toBeNull();
  });

  it('EVM-105 AC4: a failed read of the orders is the same message as "no orders"', async () => {
    const rig = rigWith();
    rig.sync.retargetOptions = () => Promise.reject(new Error('read failed (synthetic)'));
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    expect(screen.getByTestId('entry-picker-empty')).toBeOnTheScreen();
    expect(whole()).not.toContain('read failed');
  });

  it('EVM-105 AC4: the other picks of "Dodaj" still go to the stand-ins of the session', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-media'));
    expect(rig.opened).toContain('add:media');
    expect(screen.queryByTestId('entry-picker')).toBeNull();
  });

  it('EVM-105 AC4: in the hidden-data mode "Wpis" is disabled and the order data is not rendered', async () => {
    const rig = rigWith();
    await open(rig);
    await hide(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    expect(screen.getByTestId('add-entry').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    expect(screen.queryByTestId('entry-picker')).toBeNull();
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(whole()).not.toMatch(PERSONAL);
  });

  it('EVM-105 AC4: the mode that starts while the picker is open closes it', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    expect(screen.getByTestId('entry-picker')).toBeOnTheScreen();
    await hide(rig);
    expect(screen.queryByTestId('entry-picker')).toBeNull();
    expect(whole()).not.toMatch(/ZL-2026-004[23]/);
  });

  it('EVM-105 AC4 (security 4): the mode that starts while the form is open closes it at once and zeroes the text; after the return the field is empty', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type(MARKER);
    await hide(rig);
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(whole()).not.toContain(MARKER);
    expect(whole()).not.toMatch(PERSONAL);
    // back from the mode, open the form again: nothing was kept
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    // the details of the order are still open under the form: only the form (and its text) is gone
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByTestId('entry-body').props.value).toBe('');
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-105 AC4: a late answer of the read of the orders after the picker was closed (hidden-data mode) draws nothing', async () => {
    const rig = rigWith();
    let late: (value: { id: string; number: string; title: string }[]) => void = () => undefined;
    rig.sync.retargetOptions = () =>
      new Promise((resolve) => {
        late = resolve;
      });
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-entry'));
    await settle();
    await hide(rig);
    await act(async () => {
      late([{ id: 'o1', number: 'ZL-2026-0042', title: 'Garaż — pełny proces' }]);
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('entry-picker')).toBeNull();
    expect(whole()).not.toMatch(/ZL-2026-004[23]/);
  });

  it('EVM-105 AC4 (security 4): the hidden-data mode in the middle of a save does not bring the form back and the text is not stored by the screen', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await type(MARKER);
    await save();
    await hide(rig);
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(whole()).not.toContain(MARKER);
    expect(announce).not.toHaveBeenCalled();
  });

  it.each([
    ['sign-out', { reason: 'signed_out', unsentItems: 0 }],
    ['a revoked session (401 session_revoked)', { reason: 'session_revoked', unsentItems: 1 }],
  ] as const)('EVM-105 AC4 (security 4): %s with the form open removes it and the text', async (_name, ended) => {
    const rig = rigWith();
    await openForm(rig);
    await type(MARKER);
    await act(() => {
      rig.owner.end(ended);
    });
    await settle();
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(whole()).not.toContain(MARKER);
    expect(whole()).not.toMatch(PERSONAL);
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-105 AC4: the system "back" closes the form first (the text is dropped, nothing is queued), then the details', async () => {
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
      const rig = rigWith();
      await openForm(rig);
      await type(MARKER);
      let handled = false;
      await act(() => {
        handled = handlers.at(-1)?.(undefined as never) ?? false;
      });
      expect(handled).toBe(true);
      await settle();
      expect(screen.queryByTestId('entry-form')).toBeNull();
      expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
      expect(rig.sync.enqueued).toEqual([]);
      expect(whole()).not.toContain(MARKER);
    } finally {
      spy.mockRestore();
    }
  });

  it('EVM-105 AC4: "Zamknij" closes the form without saving', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('Porzucony');
    await fireEvent.press(screen.getByTestId('entry-close'));
    expect(screen.queryByTestId('entry-form')).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-105 AC4: an order that left the scope while the form is open is "unavailable" with a close action', async () => {
    const rig = rigWith();
    await openForm(rig);
    rig.sync.details.delete('o1');
    await act(() => {
      rig.sync.set({ lastSuccessAt: 777 });
    });
    await settle();
    expect(screen.getByTestId('entry-unavailable')).toBeOnTheScreen();
    expect(screen.queryByTestId('entry-save')).toBeNull();
    await fireEvent.press(screen.getByTestId('entry-unavailable-close'));
    expect(screen.queryByTestId('entry-form')).toBeNull();
  });

  it('EVM-105 AC4: a failed read of the order shows a message with a retry (no text of the error); loading is a skeleton; the retry opens the form', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    let mode: 'fail' | 'wait' | 'ok' = 'fail';
    rig.sync.orderDetailHook = (id) =>
      mode === 'fail'
        ? Promise.reject(new Error('read failed (synthetic)'))
        : mode === 'wait'
          ? new Promise(() => undefined)
          : Promise.resolve(rig.sync.details.get(id) ?? null);
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByTestId('entry-error')).toBeOnTheScreen();
    expect(whole()).not.toContain('read failed');
    mode = 'wait';
    await fireEvent.press(screen.getByTestId('entry-retry'));
    await settle();
    expect(screen.getByTestId('entry-skeleton')).toBeOnTheScreen();
    expect(treeOf('entry-form')).not.toMatch(PERSONAL);
    mode = 'ok';
    await fireEvent.press(screen.getByTestId('entry-close'));
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByTestId('entry-body')).toBeOnTheScreen();
  });
});

describe('privacy of the text (EVM-105 security 1, 3, 5, 8)', () => {
  it('EVM-105 AC1 (security 1): the text goes to the queue and nowhere else - no console, no announcement, a fixed toast, nothing in the tree afterwards', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const rig = rigWith();
      await openForm(rig);
      await type(MARKER);
      await save();
      expect(JSON.stringify(rig.sync.enqueued)).toContain(MARKER);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(MARKER);
      expect(JSON.stringify(announce.mock.calls)).not.toContain(MARKER);
      expect(announce.mock.calls).toEqual([[pl.entryForm.saved]]);
      expect(treeOf('entry-toast')).not.toContain(MARKER);
      expect(treeOf('entry-toast')).not.toContain('ZL-2026');
      expect(whole()).not.toContain(MARKER);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('EVM-105 AC1 (security 5): the text field has autofill off, autocorrect and spell check on, no length cut and no link detection', async () => {
    await openForm(rigWith());
    const { props } = screen.getByTestId('entry-body');
    expect(props.multiline).toBe(true);
    expect(props.autoCorrect).toBe(true);
    expect(props.spellCheck).toBe(true);
    expect(props.importantForAutofill).toBe('no');
    expect(props.autoComplete).toBe('off');
    expect(props.textContentType).toBe('none');
    expect(props.maxLength).toBeUndefined();
    expect(props.dataDetectorType).toBeUndefined();
    expect(props.dataDetectorTypes).toBeUndefined();
    expect(screen.getByLabelText('Treść')).toBeOnTheScreen();
  });

  it('EVM-105 AC1: the touch targets of the form are at least 48 dp and the save button is the large one', async () => {
    await openForm(rigWith());
    for (const id of ['entry-close', 'entry-kind-note', 'entry-kind-comment', 'entry-category-other', 'entry-stage', 'entry-save']) {
      expect(flat(screen.getByTestId(id)).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    }
    expect(flat(screen.getByTestId('entry-save')).minHeight).toBeGreaterThanOrEqual(56);
    expect(flat(screen.getByTestId('order-detail-add-entry', { includeHiddenElements: true })).minHeight).toBeGreaterThanOrEqual(
      size.touchTarget.min,
    );
  });

  it('EVM-105 AC1: the toast leaves after its time and the list does not show it again', async () => {
    jest.useFakeTimers();
    try {
      const rig = rigWith();
      await openForm(rig);
      await type('Toast');
      await save();
      expect(screen.getByTestId('entry-toast')).toBeOnTheScreen();
      await act(() => {
        jest.advanceTimersByTime(6100);
      });
      expect(screen.queryByTestId('entry-toast')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-105 AC4 (security 6, 8): the shell keeps the id of the order only; the form is not reachable from a link and nothing of it is stored', () => {
    const src = (name: string) => readFileSync(join(__dirname, '..', 'src', 'screens', name), 'utf8');
    const shell = src('Shell.tsx');
    expect(shell).toMatch(/type Entry = \{ readonly stage: 'pick' \} \| \{ readonly stage: 'form'; readonly orderId: string \}/);
    for (const file of ['Shell.tsx', 'EntryFormScreen.tsx', 'EntryTargetPicker.tsx']) {
      expect(src(file)).not.toMatch(
        /Linking|AsyncStorage|SecureStore|localStorage|console\.|useLocalSearchParams|navigation\.|route\.params/,
      );
    }
    expect(src('EntryFormScreen.tsx')).not.toMatch(/setDraft|setRecent|useDraft/);
  });
});
