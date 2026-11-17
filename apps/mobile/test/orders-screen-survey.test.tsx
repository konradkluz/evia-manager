import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { App } from '../src/App';
import { buildOrderList, queueFact, type OrderListSource, type OrderRow, type SourceOrder } from '../src/orders/order-list-model';
import { type StartupChecker } from '../src/startup';
import type { LucideIcon } from 'lucide-react-native';
import { Ban, ThumbsDown, Trash, TriangleAlert } from '../src/ui/icons';

import { stubPorts, type PortsRig } from './session-helpers';

// EVM-137 AC4, AC5 (security W5, W9): the list shows site surveys with the mark, the term and the date - never the address; the chip
// "Wizje lokalne (n)" narrows the list; the hidden-data mode draws no mark. Synthetic data only.
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
const DAY = 86_400_000;
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
/** The drawing (the `d` of the paths) of an icon - what tells one lucide glyph from another in the rendered tree. */
const drawing = (json: unknown): string => (JSON.stringify(json).match(/"d":"[^"]+"/g) ?? []).join('|');
const glyph = async (Glyph: LucideIcon): Promise<string> => {
  const view = await render(<Glyph />);
  const out = drawing(view.toJSON());
  await view.unmount();
  return out;
};
const NOW = Date.now();
const ADDRESS = /Fikcyjna|Piaseczno|Tajna|Gdziestam|05-500/;
const order = (id: string, extra: Partial<SourceOrder> = {}): SourceOrder => ({
  id,
  number: `ZL-2026-00${id.slice(-2)}`,
  status: 'quoting',
  createdAt: Date.UTC(2026, 10, 16, 12, 0, 0),
  customerId: null,
  siteId: 's1',
  survey: null,
  ...extra,
});
const source = (orders: SourceOrder[]): OrderListSource => ({
  orders,
  customers: [],
  sites: [{ id: 's1', street: 'ul. Fikcyjna', buildingNumber: '12', city: 'Piaseczno', parkingSpot: '' }],
  stages: [],
});
const rowsOf = (orders: SourceOrder[], facts: Parameters<typeof buildOrderList>[1] = []): OrderRow[] =>
  buildOrderList(source(orders), facts);
const survey = (days: number) => ({ expiresAt: NOW + days * DAY, extensionCount: 0 });
const ids = { a: 'o-a1', b: 'o-b2', c: 'o-c3', plain: 'o-p9' };

async function open(rows: OrderRow[], tweak: (rig: PortsRig) => void = () => undefined) {
  const rig = stubPorts();
  rig.sync.rows = rows;
  tweak(rig);
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  return rig;
}

describe('the card of a survey (EVM-137 AC4)', () => {
  it('EVM-137 AC4: number, status, the mark "Wizja lokalna", the term and the date of creation - and NO address anywhere on the list', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(80) })]));
    const card = screen.getByTestId(`order-row-${ids.a}`);
    expect(within(card).getByText('ZL-2026-00a1')).toBeOnTheScreen();
    expect(within(card).getByText('Wycena')).toBeOnTheScreen();
    expect(within(card).getByTestId(`order-survey-mark-${ids.a}`)).toHaveTextContent('Wizja lokalna');
    expect(within(card).getByTestId(`order-survey-term-${ids.a}`)).toHaveTextContent('Wygasa za 80 dni');
    expect(within(card).getByText('Założono 16.11.2026')).toBeOnTheScreen();
    expect(whole()).not.toMatch(ADDRESS);
  });

  it('EVM-137 AC4: the accessible name has the number, the status, the date and the term - and no address', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(80) })]));
    const name = String(screen.getByTestId(`order-row-${ids.a}`).props.accessibilityLabel);
    expect(name).toBe(
      `Wizja lokalna, ZL-2026-00a1, Wycena, założono 16.11.2026, wygasa za 80 dni, dnia ${new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }).format(NOW + 80 * DAY)}`,
    );
    expect(name).not.toMatch(ADDRESS);
  });

  it('EVM-137 AC4: 15 days and fewer are a warning in the name too ("wymaga decyzji biura"); the singular and "dziś" are spoken right', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(12) }), order(ids.b, { survey: survey(1) }), order(ids.c, { survey: survey(0) })]));
    expect(String(screen.getByTestId(`order-row-${ids.a}`).props.accessibilityLabel)).toContain('wygasa za 12 dni — wymaga decyzji biura');
    expect(screen.getByTestId(`order-survey-term-${ids.b}`)).toHaveTextContent('Wygasa za 1 dzień');
    expect(screen.getByTestId(`order-survey-term-${ids.c}`)).toHaveTextContent('Wygasa dziś');
  });

  it('EVM-137 AC4: after the term and before the removal: "Termin minął — wizja zostanie wkrótce usunięta."', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(-2) })]));
    expect(screen.getByTestId(`order-survey-term-${ids.a}`)).toHaveTextContent('Termin minął — wizja zostanie wkrótce usunięta.');
  });

  it('EVM-137 AC4: a survey the office rejected (Anulowane) is marked "Odrzucona" and says when it will be removed', async () => {
    await open(rowsOf([order(ids.a, { status: 'cancelled', survey: survey(9) })]));
    expect(screen.getByTestId(`order-survey-rejected-${ids.a}`)).toHaveTextContent('Odrzucona');
    expect(screen.getByTestId(`order-survey-term-${ids.a}`)).toHaveTextContent('Usunięcie za 9 dni');
    expect(screen.getByTestId(`order-row-${ids.a}`).props.accessibilityLabel).toContain('odrzucona');
  });

  it('EVM-137 AC4: the mark "Odrzucona" has its own icon (thumbs-down), not that of "Anulowane" (ban); the removal term has trash', async () => {
    const [down, ban, trash] = [await glyph(ThumbsDown), await glyph(Ban), await glyph(Trash)];
    await open(rowsOf([order(ids.a, { status: 'cancelled', survey: survey(9) })]));
    const mark = screen.getByTestId(`order-survey-rejected-${ids.a}`);
    expect(mark).toHaveTextContent('Odrzucona');
    const markDrawing = drawing(mark);
    expect(markDrawing).toBe(down);
    expect(markDrawing).not.toBe(ban);
    expect(drawing(screen.getByTestId(`order-status-${ids.a}`))).toBe(ban);
    expect(drawing(screen.getByTestId(`order-survey-term-${ids.a}`))).toBe(trash);
  });

  it('EVM-137 AC6: a rejected survey that was never sent says "Wymaga uwagi" with triangle-alert instead of "Oczekuje na numer", still without an address', async () => {
    const record = {
      mutationId: 'm-2',
      type: 'CreateSiteSurvey',
      commandVersion: 1,
      payload: { workOrderId: 'o-rej', newSite: { street: 'ul. Tajna', buildingNumber: '9', city: 'Gdziestam', postalCode: '05-500' } },
      objectId: 'o-rej',
      orderingKey: 'o-rej',
      createdAt: NOW,
      ownerUserId: 'u1',
      state: 'needs_attention',
      attempts: 1,
    } as const;
    const alert = await glyph(TriangleAlert);
    await open(rowsOf([], [queueFact(record, true)]));
    const card = screen.getByTestId('order-row-o-rej');
    const badge = within(card).getByTestId('order-attention-o-rej');
    expect(badge).toHaveTextContent('Wymaga uwagi');
    expect(drawing(badge)).toBe(alert);
    expect(within(card).queryByText('Oczekuje na numer')).toBeNull();
    expect(within(card).queryByTestId('order-awaiting-o-rej')).toBeNull();
    expect(within(card).getByTestId('order-survey-mark-o-rej')).toBeOnTheScreen();
    expect(String(card.props.accessibilityLabel)).toMatch(/^Wizja lokalna, wymaga uwagi, zapisano w telefonie/);
    expect(whole()).not.toMatch(ADDRESS);
  });

  it('EVM-137 AC2: a survey that waits for its number says so and when it was saved on the phone (no number, no address)', async () => {
    const record = {
      mutationId: 'm-1',
      type: 'CreateSiteSurvey',
      commandVersion: 1,
      payload: { workOrderId: 'o-new', newSite: { street: 'ul. Tajna', buildingNumber: '9', city: 'Gdziestam', postalCode: '05-500' } },
      objectId: 'o-new',
      orderingKey: 'o-new',
      createdAt: NOW,
      ownerUserId: 'u1',
      state: 'pending',
      attempts: 0,
    } as const;
    await open(rowsOf([], [queueFact(record, true)]));
    const card = screen.getByTestId('order-row-o-new');
    expect(within(card).getByTestId('order-awaiting-o-new')).toHaveTextContent('Oczekuje na numer');
    expect(within(card).getByTestId('order-survey-mark-o-new')).toBeOnTheScreen();
    expect(within(card).getByText(/^Zapisano w telefonie \d{1,2}:\d{2}$/)).toBeOnTheScreen();
    expect(within(card).getByTestId('order-survey-term-o-new')).toHaveTextContent('Wygasa za 90 dni');
    expect(whole()).not.toMatch(ADDRESS);
    expect(String(card.props.accessibilityLabel)).toMatch(/^Wizja lokalna, oczekuje na numer, zapisano w telefonie \d{1,2}:\d{2}/);
  });

  it('EVM-137 AC4: an ordinary order next to the survey is as before (its address stays)', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(80) }), order(ids.plain, { status: 'in_progress', customerId: 'c1' })]));
    expect(within(screen.getByTestId(`order-row-${ids.plain}`)).getByText('ul. Fikcyjna 12, Piaseczno')).toBeOnTheScreen();
    expect(screen.queryByTestId(`order-survey-mark-${ids.plain}`)).toBeNull();
  });
});

describe('the chip "Wizje lokalne (n)" (EVM-137 AC4)', () => {
  const mixed = () =>
    rowsOf([order(ids.a, { survey: survey(80) }), order(ids.b, { survey: survey(5) }), order(ids.plain, { status: 'in_progress' })]);

  it('EVM-137 AC4: the chip is in the same radio group with the count and the name "Filtr: Wizje lokalne, 2"; it narrows the list to the surveys', async () => {
    await open(mixed());
    const chip = screen.getByTestId('orders-chip-survey');
    expect(chip).toHaveTextContent('Wizje lokalne (2)');
    expect(screen.getByLabelText('Filtr: Wizje lokalne, 2')).toBeOnTheScreen();
    await fireEvent.press(chip);
    expect(screen.getByTestId(`order-row-${ids.a}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`order-row-${ids.b}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`order-row-${ids.plain}`)).toBeNull();
    expect(screen.getByLabelText('Filtr: Wizje lokalne, 2, wybrane')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('orders-chip-all'));
    expect(screen.getByTestId(`order-row-${ids.plain}`)).toBeOnTheScreen();
  });

  it('EVM-137 AC4: no survey in the phone - no chip', async () => {
    await open(rowsOf([order(ids.plain, { status: 'in_progress' })]));
    expect(screen.queryByTestId('orders-chip-survey')).toBeNull();
  });

  it('EVM-137 AC4: the chip stays selected when the last survey leaves, and the list explains why it is empty (only the own and the cared-for surveys are on the phone)', async () => {
    const rig = await open(mixed());
    await fireEvent.press(screen.getByTestId('orders-chip-survey'));
    rig.sync.rows = rowsOf([order(ids.plain, { status: 'in_progress' })]);
    await act(() => {
      rig.sync.set({ lastSuccessAt: 1 });
    });
    await settle();
    expect(screen.getByTestId('orders-survey-empty')).toHaveTextContent(
      'Nie masz wizji lokalnych w telefonie. W telefonie widzisz tylko wizje, które założyłeś lub którymi się opiekujesz.',
    );
    expect(screen.getByTestId('orders-chip-survey')).toHaveTextContent('Wizje lokalne (0)');
  });

  it('EVM-137 AC4: the search by address finds a survey, and the found card still shows none', async () => {
    await open(rowsOf([order(ids.a, { survey: survey(80) }), order(ids.b, { survey: survey(5) })]));
    await fireEvent.changeText(screen.getByTestId('orders-search'), 'fikcyjna');
    expect(screen.getByTestId(`order-row-${ids.a}`)).toBeOnTheScreen();
    expect(whole()).not.toMatch(/ul\. Fikcyjna 12/);
  });
});

describe('the hidden-data mode (EVM-137 AC5, W9)', () => {
  it('EVM-137 AC5: the list draws no surveys at all in the mode (the list is replaced by the notice, no chip, no mark, no term)', async () => {
    const rig = stubPorts();
    rig.sync.rows = rowsOf([order(ids.a, { survey: survey(80) })]);
    rig.device.facts.secure = false;
    await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
    expect(screen.queryByTestId('orders-chip-survey')).toBeNull();
    expect(screen.queryByTestId(`order-survey-mark-${ids.a}`)).toBeNull();
    expect(screen.queryByText(/Wygasa/)).toBeNull();
    expect(screen.queryByText('Wymaga uwagi')).toBeNull();
    expect(whole()).not.toMatch(ADDRESS);
  });
});
