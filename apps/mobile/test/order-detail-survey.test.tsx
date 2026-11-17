import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { App } from '../src/App';
import type { OrderDetail } from '../src/orders/order-detail-model';
import { buildOrderList, type OrderRow } from '../src/orders/order-list-model';
import { type StartupChecker } from '../src/startup';
import { stubPorts, type PortsRig } from './session-helpers';

// EVM-137 AC4, AC5, AC6, AC7 (security W5, W9): the details of a site survey from the replica - the only place of the address and the phone.
// Synthetic data only.
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
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);
const ID = 'o-s1';
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

const survey = (days: number, phone: string | null = '600 000 011') => ({
  expiresAt: Date.now() + days * DAY,
  extensionCount: 0,
  requesterPhone: phone,
  dial: phone === null ? null : phone.replaceAll(' ', ''),
});
const detail = (extra: Partial<OrderDetail> = {}): OrderDetail => ({
  id: ID,
  number: 'ZL-2026-0051',
  title: 'Wizja lokalna',
  status: 'quoting',
  survey: survey(80),
  customer: null,
  location: { street: 'ul. Fikcyjna 12', city: '05-500 Piaseczno', spot: null, level: null, powerKw: null, operator: null, manager: null },
  scope: [],
  processes: [],
  journal: [],
  ...extra,
});
const rows = (): OrderRow[] =>
  buildOrderList(
    {
      orders: [
        {
          id: ID,
          number: 'ZL-2026-0051',
          status: 'quoting',
          createdAt: T0,
          customerId: null,
          siteId: null,
          survey: { expiresAt: T0 + 80 * DAY, extensionCount: 0 },
        },
      ],
      customers: [],
      sites: [],
      stages: [],
    },
    [],
  );

async function openDetail(rig: PortsRig) {
  rig.sync.rows = rows();
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByTestId(`order-row-${ID}`));
  await settle();
}
const rigWith = (d: OrderDetail | null): PortsRig => {
  const rig = stubPorts();
  if (d !== null) rig.sync.details.set(ID, d);
  return rig;
};

let announce: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('a survey of the replica (EVM-137 AC4)', () => {
  it('EVM-137 AC4: the number, the status, the mark, the term with the date, the address, the phone and "Brak klienta" - and no client, scope or process', async () => {
    await openDetail(rigWith(detail()));
    expect(screen.getByTestId('order-detail-status')).toHaveTextContent('Wycena');
    expect(screen.getByTestId('order-detail-survey-badge')).toHaveTextContent('Wizja lokalna');
    expect(screen.getByTestId('order-detail-survey-expiry')).toHaveTextContent('Wygasa za 80 dni');
    expect(screen.getByTestId('order-detail-location')).toHaveTextContent(/ul\. Fikcyjna 12, 05-500 Piaseczno/);
    expect(screen.getByTestId('order-detail-survey-phone')).toHaveTextContent(/600 000 011/);
    expect(screen.getByTestId('order-detail-no-customer')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail-customer')).toBeNull();
    expect(screen.queryByTestId('order-detail-scope')).toBeNull();
    expect(screen.queryByText('Procesy i etapy')).toBeNull();
    expect(screen.queryByTestId('order-detail-office')).toBeNull();
  });

  it('EVM-137 AC4: 15 days and fewer: the term is a warning and says the office extends it ("Wizję może przedłużyć biuro w panelu.") - no button to extend', async () => {
    await openDetail(rigWith(detail({ survey: survey(12) })));
    expect(screen.getByTestId('order-detail-survey-expiry')).toHaveTextContent('Wygasa za 12 dni');
    expect(screen.getByTestId('order-detail-survey-office')).toHaveTextContent('Wizję może przedłużyć biuro w panelu.');
    expect(screen.queryByText(/Przedłuż/)).toBeNull();
    expect(screen.queryByText(/Przypisz klienta/)).toBeNull();
  });

  it('EVM-137 AC4: a survey without a phone has no phone card and no call button', async () => {
    await openDetail(rigWith(detail({ survey: survey(80, null) })));
    expect(screen.queryByTestId('order-detail-survey-phone')).toBeNull();
    expect(screen.queryByTestId('order-detail-call')).toBeNull();
  });

  it('EVM-137 AC4: a survey the office rejected: "Odrzucona", the removal date, and the information that it goes away with its photos and entries', async () => {
    await openDetail(rigWith(detail({ status: 'cancelled', survey: survey(12) })));
    expect(screen.getByTestId('order-detail-survey-expiry')).toHaveTextContent('Usunięcie za 12 dni');
    expect(screen.getByTestId('order-detail-survey-rejected')).toHaveTextContent('Odrzucona');
    expect(screen.getByTestId('order-detail-survey-rejected-info')).toHaveTextContent(
      'Biuro odrzuciło tę wizję. Zostanie usunięta razem ze zdjęciami i wpisami.',
    );
    // photos and entries can still be added (like to any closed order): the bottom bar stays
    expect(screen.getByTestId('order-detail-take-photo')).toBeEnabled();
  });

  it('EVM-137 AC4: the survey has no photos or entries yet: the journal says so, the camera is the main action', async () => {
    await openDetail(rigWith(detail()));
    expect(screen.getByTestId('order-detail-journal-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-take-photo')).toBeEnabled();
  });
});

describe('the office gave the survey a client (EVM-137 AC7)', () => {
  it('EVM-137 AC7: the same screen becomes an ordinary order in place - the mark, the term and "Brak klienta" go, the client appears, the number and the entries stay; no toast, no announcement', async () => {
    const entry = {
      id: 'j-1',
      source: 'synced' as const,
      kind: 'note' as const,
      category: 'site_visit',
      author: null,
      at: T0,
      body: 'Garaż od podwórza',
      redacted: false,
      superseded: false,
      correction: false,
    };
    const rig = rigWith(detail({ journal: [entry] }));
    await openDetail(rig);
    expect(screen.getByTestId('order-detail-survey-badge')).toBeOnTheScreen();
    announce.mockClear();
    // the next synchronization brings the client (the survey is null, the customer is set)
    rig.sync.details.set(
      ID,
      detail({
        survey: null,
        status: 'accepted',
        customer: { name: 'Jan Przykładowy', phone: '+48 600 000 001', dial: '+48600000001' },
        journal: [entry],
      }),
    );
    await act(() => {
      rig.sync.set({ lastSuccessAt: 5 });
    });
    await settle();
    expect(screen.queryByTestId('order-detail-survey-badge')).toBeNull();
    expect(screen.queryByTestId('order-detail-survey-expiry')).toBeNull();
    expect(screen.queryByTestId('order-detail-no-customer')).toBeNull();
    expect(screen.queryByTestId('order-detail-survey-phone')).toBeNull();
    expect(within(screen.getByTestId('order-detail-customer')).getByText('Jan Przykładowy')).toBeOnTheScreen();
    expect(screen.getByText('Garaż od podwórza')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-status')).toHaveTextContent('Zaakceptowane');
    expect(screen.queryByTestId('quick-order-toast')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('a survey that is gone (EVM-137 AC6)', () => {
  it('EVM-137 AC6: when the survey leaves the phone while the screen is open, the screen says so and leads to the Queue where the unsent photos and entries wait', async () => {
    const rig = rigWith(detail());
    rig.sync.surveyIds.add(ID);
    await openDetail(rig);
    rig.sync.details.delete(ID);
    await act(() => {
      rig.sync.set({ lastSuccessAt: 6 });
    });
    await settle();
    expect(screen.getByTestId('order-detail-survey-gone')).toHaveTextContent(
      /Nie znaleziono zlecenia\. Twoje niewysłane zdjęcia i wpisy z tego zlecenia są w Kolejce\./,
    );
    await fireEvent.press(screen.getByTestId('order-detail-survey-gone-queue'));
    await settle();
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail')).toBeNull();
  });

  it('EVM-137 AC6: an ordinary order that is gone keeps its message (no regression)', async () => {
    const rig = rigWith(detail({ survey: null, customer: null }));
    await openDetail(rig);
    rig.sync.details.delete(ID);
    await act(() => {
      rig.sync.set({ lastSuccessAt: 6 });
    });
    await settle();
    expect(screen.getByTestId('order-detail-unavailable')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-detail-survey-gone')).toBeNull();
  });
});

describe('the hidden-data mode (EVM-137 AC5, W9)', () => {
  it('EVM-137 AC5: the details of a survey are not drawn in the mode - no address, no phone, no mark - and the camera stays', async () => {
    const rig = rigWith(detail());
    await openDetail(rig);
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.queryByTestId('order-detail-survey-badge')).toBeNull();
    expect(screen.queryByTestId('order-detail-survey-phone')).toBeNull();
    expect(whole()).not.toMatch(/Fikcyjna|Piaseczno|05-500|600 000 011|Wizja lokalna/);
    expect(screen.getByTestId('order-detail-take-photo')).toBeOnTheScreen();
  });
});

describe('accessibility (EVM-137 AC4)', () => {
  it('EVM-137 AC4: the address wraps and is never cut (no numberOfLines), the touch target of the call button is not smaller than 48', async () => {
    await openDetail(rigWith(detail()));
    const address = within(screen.getByTestId('order-detail-location')).getByText(/ul\. Fikcyjna 12, 05-500 Piaseczno/);
    expect(address.props.numberOfLines).toBeUndefined();
    const call = screen.getByTestId('order-detail-call');
    const styles = [(call.props as { style?: unknown }).style].flat(5).filter(Boolean) as Record<string, number>[];
    const style = Object.assign({}, ...styles) as Record<string, number>;
    expect(style['minHeight'] ?? 48).toBeGreaterThanOrEqual(48);
  });
});

describe('the entry form of a survey (EVM-137 W8)', () => {
  it('EVM-137 W8: the hint of the entry of a survey says not to write names and phones (the survey has no field for them); an ordinary order keeps its hint', async () => {
    const rig = rigWith(detail());
    await openDetail(rig);
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(
      screen.getByText('Nie wpisuj imion ani telefonów. Nie wpisuj też PESEL, numerów dokumentów ani kodów do bram i alarmów.'),
    ).toBeOnTheScreen();
  });

  it('EVM-137 W8: an ordinary order has the old hint only', async () => {
    const rig = rigWith(detail({ survey: null, customer: null }));
    await openDetail(rig);
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    expect(screen.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeOnTheScreen();
    expect(screen.queryByText(/Nie wpisuj imion/)).toBeNull();
  });
});
