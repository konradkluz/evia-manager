import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { buildOrderList, queueFact } from '../src/orders/order-list-model';
import type { QueueRecord } from '@evia/sync-core';
import type { OrderDetail } from '../src/orders/order-detail-model';
import type { QuickOrderSource } from '../src/orders/quick-order-model';
import type { TemplateSet } from '../src/orders/templates';
import { type StartupChecker } from '../src/startup';
import { stubPorts, type PortsRig } from './session-helpers';

// EVM-106 AC1-AC3, AC6 (+ security K4-K9): the quick work order form on the phone - written into the durable queue, never anywhere else.
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

const T_HOUSE = '0194c2a0-0000-7000-8000-000000000a01';
const T_GARAGE = '0194c2a0-0000-7000-8000-000000000a02';
const TEMPLATES: TemplateSet = {
  fetchedAt: 1,
  items: [
    {
      id: T_HOUSE,
      code: 'house',
      name: 'Dom — sam montaż',
      siteTypeHint: 'single_family_house',
      itemCount: 3,
      procedureCount: 1,
      milestoneCount: 1,
    },
    {
      id: T_GARAGE,
      code: 'garage',
      name: 'Garaż — pełny proces',
      siteTypeHint: 'multi_family_garage',
      itemCount: 9,
      procedureCount: 9,
      milestoneCount: 4,
    },
  ],
};
const PHONE_SOURCE: QuickOrderSource = {
  customers: [{ id: 'c-1', kind: 'person', displayName: 'Jan Przykładowy', phone: '+48 600 000 001' }],
  sites: [
    {
      id: 's-1',
      siteType: 'multi_family_garage',
      street: 'ul. Fikcyjna',
      buildingNumber: '12',
      apartmentNumber: '',
      postalCode: '05-500',
      city: 'Piaseczno',
      parkingSpotNumber: 'B-12',
    },
  ],
};
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function open(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const rigWith = (templates: TemplateSet | null = TEMPLATES, source: QuickOrderSource = { customers: [], sites: [] }): PortsRig => {
  const rig = stubPorts();
  rig.sync.templateSet = templates;
  rig.sync.quickSource = source;
  return rig;
};
const openForm = async (rig: PortsRig) => {
  await open(rig);
  await fireEvent.press(screen.getByTestId('orders-add'));
  await fireEvent.press(screen.getByTestId('add-new-order'));
  await settle();
};
const type = async (testID: string, value: string) => {
  await fireEvent.changeText(screen.getByTestId(testID), value);
};
const fillNewHouse = async () => {
  await type('quick-first-name', 'Anna');
  await type('quick-last-name', 'Fikcyjna');
  await type('quick-phone', '600 000 009');
  await fireEvent.press(screen.getByTestId('quick-site-type'));
  await fireEvent.press(screen.getByTestId('quick-site-type-single_family_house'));
  await type('quick-street', 'ul. Testowa');
  await type('quick-building', '5');
  await type('quick-postal', '05-500');
  await type('quick-city', 'Piaseczno');
  await fireEvent.press(screen.getByTestId(`quick-template-${T_HOUSE}`));
};
const save = async () => {
  await fireEvent.press(screen.getByTestId('quick-order-save'));
  await settle();
};
const hide = async (rig: PortsRig) => {
  rig.device.facts.secure = false;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};
const payloadOf = (rig: PortsRig): Record<string, unknown> => rig.sync.enqueued[0]?.payload as Record<string, unknown>;

let announce: jest.SpyInstance;
let a11yFocus: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  a11yFocus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});
afterEach(() => {
  announce.mockRestore();
  a11yFocus.mockRestore();
});

describe('templates on the form (EVM-106 AC1)', () => {
  it('EVM-106 AC1: without templates the form says so and "Zapisz zlecenie" is not available', async () => {
    const rig = rigWith(null);
    await openForm(rig);
    expect(within(screen.getByTestId('quick-no-templates')).getByText(pl.quickOrder.noTemplates)).toBeOnTheScreen();
    expect(pl.quickOrder.noTemplates).toBe('Brak szablonów w telefonie. Połącz się z internetem, aby je pobrać.');
    expect(screen.getByTestId('quick-order-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-106 AC1: templates that arrive while the form is open (the first cycle ends later) replace the notice and enable saving', async () => {
    const rig = rigWith(null);
    await openForm(rig);
    expect(screen.getByTestId('quick-no-templates')).toBeOnTheScreen();
    rig.sync.templateSet = TEMPLATES;
    await act(() => {
      rig.sync.set({ lastSuccessAt: 999_000 });
    });
    await settle();
    expect(screen.queryByTestId('quick-no-templates')).toBeNull();
    expect(screen.getByTestId(`quick-template-${T_HOUSE}`)).toBeOnTheScreen();
    expect(screen.getByTestId('quick-order-save')).toBeEnabled();
  });

  it('EVM-106 AC1: an empty set of templates is the same as none', async () => {
    const rig = rigWith({ fetchedAt: 1, items: [] });
    await openForm(rig);
    expect(screen.getByTestId('quick-no-templates')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-order-save')).toBeDisabled();
  });

  it('EVM-106 AC1: the templates of the phone are cards with the counts in Polish plural forms; the choice is a radio', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.getByTestId(`quick-template-${T_HOUSE}`).props.accessibilityRole).toBe('radio');
    expect(screen.getByText('3 pozycje · 1 proces · 1 transza')).toBeOnTheScreen();
    expect(screen.getByTestId(`quick-template-${T_HOUSE}`).props.accessibilityLabel).toBe(
      'Dom — sam montaż, 3 pozycje · 1 proces · 1 transza',
    );
    expect(screen.queryByTestId('quick-no-templates')).toBeNull();
    expect(screen.getByTestId('quick-order-save')).toBeEnabled();
  });
});

describe('creating offline (EVM-106 AC2)', () => {
  it('EVM-106 AC2: "Dodaj → Nowe zlecenie" opens the form; a phone without customers and places starts on "Nowy klient" and "Nowa"', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
    expect(screen.getByText(pl.quickOrder.numberInfo)).toBeOnTheScreen();
    expect(screen.queryByTestId('quick-customer-existing')).toBeNull();
    expect(screen.queryByTestId('quick-site-existing')).toBeNull();
    expect(screen.getByTestId('quick-first-name')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-street')).toBeOnTheScreen();
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-106 AC2: a new customer and a new place give CreateQuickWorkOrder v1 with new UUIDv7 ids, the template and the title of the template', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fillNewHouse();
    expect(screen.getByTestId('quick-title').props.value).toBe('Dom — sam montaż');
    await type('quick-note', 'Oględziny w piątek');
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(rig.sync.enqueued[0]).toMatchObject({ type: 'CreateQuickWorkOrder', commandVersion: 1 });
    const payload = payloadOf(rig);
    expect(payload).toMatchObject({
      templateId: T_HOUSE,
      title: 'Dom — sam montaż',
      note: 'Oględziny w piątek',
      newCustomer: { kind: 'person', displayName: 'Anna Fikcyjna', phone: '600 000 009' },
      newSite: { siteType: 'single_family_house', street: 'ul. Testowa', buildingNumber: '5', postalCode: '05-500', city: 'Piaseczno' },
    });
    const ids = [
      payload['workOrderId'],
      (payload['newCustomer'] as { id: string }).id,
      (payload['newSite'] as { id: string }).id,
    ] as string[];
    for (const id of ids) expect(id).toMatch(UUID_V7);
    expect(new Set(ids).size).toBe(3);
  });

  it('EVM-106 AC2: the form closes AFTER the queue confirmed the write; then the toast, the announcement and the details of the new order (no number)', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await fillNewHouse();
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-street').props.value).toBe('ul. Testowa');
    expect(screen.queryByTestId('quick-order-toast')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    const workOrderId = payloadOf(rig)['workOrderId'] as string;
    const pending: OrderDetail = {
      id: workOrderId,
      number: null,
      title: 'Dom — sam montaż',
      status: 'new',
      awaitingNumber: true,
      templateName: 'Dom — sam montaż',
      note: null,
      customer: { name: 'Anna Fikcyjna', phone: '600 000 009', dial: '600000009' },
      location: {
        street: 'ul. Testowa 5',
        city: '05-500 Piaseczno',
        spot: null,
        level: null,
        powerKw: null,
        operator: null,
        manager: null,
      },
      scope: [],
      processes: [],
      journal: [],
    };
    rig.sync.details.set(workOrderId, pending);
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(
      within(screen.getByTestId('quick-order-toast')).getByText('Zapisano w telefonie. Numer nadamy po synchronizacji.'),
    ).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(pl.quickOrder.saved);
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    expect(rig.sync.detailRequests).toContain(workOrderId);
    expect(within(screen.getByTestId('order-detail-awaiting')).getByText('Oczekuje na numer')).toBeOnTheScreen();
    expect(within(screen.getByTestId('order-detail-pending-banner')).getByText(pl.orderDetail.pendingBanner)).toBeOnTheScreen();
  });

  it('EVM-106 AC2: one touch = one command - a second touch before the answer adds nothing, the button is busy', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await fillNewHouse();
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    await settle();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(screen.getByTestId('quick-order-save').props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(rig.sync.enqueued).toHaveLength(1);
  });

  it.each([
    ['storage_failure', 'Brak miejsca — zlecenie zostaje w formularzu.'],
    ['payload_too_large', pl.quickOrder.errors.too_large],
    ['anything_else', pl.quickOrder.errors.failed],
  ])('EVM-106 AC2: a refused write (%s) keeps the form and the data and tells the reason without them', async (code, message) => {
    const rig = rigWith();
    rig.sync.result = { ok: false, code };
    await openForm(rig);
    await fillNewHouse();
    await save();
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
    expect(within(screen.getByTestId('quick-order-alert')).getByText(message)).toBeOnTheScreen();
    expect(screen.getByTestId('quick-street').props.value).toBe('ul. Testowa');
    expect(screen.queryByTestId('quick-order-toast')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    // the next try works and takes new ids
    rig.sync.result = { ok: true };
    await save();
    expect(rig.sync.enqueued).toHaveLength(2);
    expect(payloadOf(rig)['workOrderId']).not.toBe((rig.sync.enqueued[1]?.payload as { workOrderId: string }).workOrderId);
  });

  it('EVM-106 AC2: a thrown queue error is the same fixed message; the data stay', async () => {
    const rig = rigWith();
    rig.sync.enqueueHook = () => Promise.reject(new Error('Anna Fikcyjna 600 000 009'));
    await openForm(rig);
    await fillNewHouse();
    await save();
    expect(within(screen.getByTestId('quick-order-alert')).getByText(pl.quickOrder.errors.failed)).toBeOnTheScreen();
    expect(screen.getByTestId('quick-first-name').props.value).toBe('Anna');
  });

  it('EVM-106 AC2: the templates are filtered by the type of the place; "Pokaż wszystkie szablony" removes the filter and back', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-multi_family_garage'));
    expect(screen.getByTestId(`quick-template-${T_GARAGE}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`quick-template-${T_HOUSE}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('quick-template-show-all'));
    expect(screen.getByTestId(`quick-template-${T_HOUSE}`)).toBeOnTheScreen();
    expect(within(screen.getByTestId('quick-template-show-all')).getByText(pl.quickOrder.showFilteredTemplates)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-template-show-all'));
    expect(screen.queryByTestId(`quick-template-${T_HOUSE}`)).toBeNull();
  });

  it('EVM-106 AC3: a chosen template that the new type of the place filters out is dropped; saving asks for a template again; the typed title stays', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fillNewHouse();
    await type('quick-title', 'Mój tytuł');
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-multi_family_garage'));
    await settle();
    expect(screen.queryByTestId(`quick-template-${T_HOUSE}`)).toBeNull();
    expect(screen.getByTestId(`quick-template-${T_GARAGE}`).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('quick-title').props.value).toBe('Mój tytuł');
    await save();
    expect(rig.sync.enqueued).toHaveLength(0);
    expect(screen.getByTestId('quick-template-error')).toHaveTextContent(pl.quickOrder.errors.template.required);
  });

  it('EVM-106 AC3: the title that was only the default of the dropped template goes with it; "Pokaż wszystkie" keeps a chosen template', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-single_family_house'));
    await fireEvent.press(screen.getByTestId(`quick-template-${T_HOUSE}`));
    expect(screen.getByTestId('quick-title').props.value).toBe('Dom — sam montaż');
    await fireEvent.press(screen.getByTestId('quick-template-show-all'));
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-multi_family_garage'));
    await settle();
    expect(screen.getByTestId(`quick-template-${T_HOUSE}`).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByTestId('quick-template-show-all'));
    await settle();
    expect(screen.getByTestId('quick-title').props.value).toBe('');
  });

  it('EVM-106 AC2: the number of the parking spot exists for a garage only and goes into the new place; the default title does not overwrite a typed one', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.queryByTestId('quick-spot')).toBeNull();
    await type('quick-first-name', 'Anna');
    await type('quick-last-name', 'Fikcyjna');
    await type('quick-phone', '600 000 009');
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-multi_family_garage'));
    await type('quick-spot', 'B-12');
    await type('quick-street', 'ul. Garażowa');
    await type('quick-building', '1');
    await type('quick-postal', '00-001');
    await type('quick-city', 'Warszawa');
    await type('quick-title', 'Mój tytuł');
    await fireEvent.press(screen.getByTestId(`quick-template-${T_GARAGE}`));
    expect(screen.getByTestId('quick-title').props.value).toBe('Mój tytuł');
    await save();
    expect(payloadOf(rig)).toMatchObject({ title: 'Mój tytuł', templateId: T_GARAGE, newSite: { parkingSpotNumber: 'B-12' } });
  });

  it('EVM-106 AC2: a customer and a place of the phone are chosen from the search and only referred to by id; a company has one name field', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    expect(screen.getByTestId('quick-customer-existing').props.accessibilityState).toMatchObject({ checked: true });
    await type('quick-customer-search', 'przyklad');
    await fireEvent.press(screen.getByTestId('quick-customer-pick-c-1'));
    await fireEvent.press(screen.getByTestId('quick-site-pick-s-1'));
    await fireEvent.press(screen.getByTestId(`quick-template-${T_GARAGE}`));
    await save();
    expect(payloadOf(rig)).toMatchObject({ customerId: 'c-1', siteId: 's-1', templateId: T_GARAGE });
    expect(payloadOf(rig)).not.toHaveProperty('newCustomer');
    expect(payloadOf(rig)).not.toHaveProperty('newSite');
  });

  it('EVM-106 AC2: "Nowy klient" can be a company (one name field, no first and last name)', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    await fireEvent.press(screen.getByTestId('quick-kind-company'));
    expect(screen.queryByTestId('quick-first-name')).toBeNull();
    await type('quick-company-name', 'Firma Przykład sp. z o.o.');
    await type('quick-phone', '+48 600 000 003');
    await fireEvent.press(screen.getByTestId('quick-site-pick-s-1'));
    await fireEvent.press(screen.getByTestId(`quick-template-${T_GARAGE}`));
    await save();
    expect(payloadOf(rig)).toMatchObject({ newCustomer: { kind: 'company', displayName: 'Firma Przykład sp. z o.o.' }, siteId: 's-1' });
  });

  it('EVM-106 AC2: the search of the phone says so when nothing matches', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await type('quick-customer-search', 'zzzz');
    expect(screen.getByText(pl.quickOrder.customersNone)).toBeOnTheScreen();
    await type('quick-site-search', 'zzzz');
    expect(screen.getByText(pl.quickOrder.sitesNone)).toBeOnTheScreen();
  });
});

describe('validation and similar customers (EVM-106 AC3)', () => {
  it('EVM-106 AC3: an empty form saves nothing, shows the summary (focused) and the errors at the fields', async () => {
    const rig = rigWith();
    await openForm(rig);
    await save();
    expect(rig.sync.enqueued).toEqual([]);
    const summary = screen.getByTestId('quick-order-errors');
    expect(within(summary).getByText(/Podaj numer telefonu, np\. 600 000 001\./)).toBeOnTheScreen();
    expect(within(summary).getByText(/Podaj adres lokalizacji\./)).toBeOnTheScreen();
    expect(within(summary).getByText(/Wybierz szablon\./)).toBeOnTheScreen();
    expect(within(summary).getByText(/Wpisz tytuł zlecenia\./)).toBeOnTheScreen();
    expect(screen.getByTestId('quick-phone-error')).toHaveTextContent('Podaj numer telefonu, np. 600 000 001.');
    expect(screen.getByTestId('quick-street-error')).toHaveTextContent('Podaj adres lokalizacji.');
    expect(screen.getByTestId('quick-title-error')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-template-error')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-site-type-error')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-first-name-error')).toBeOnTheScreen();
    expect(a11yFocus).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('EVM-106 AC3: a phone outside the pattern of the contract, a one-word name, a wrong postal code and a long title are each refused at the field', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fillNewHouse();
    await type('quick-phone', 'abc');
    await type('quick-last-name', '');
    await type('quick-postal', '5500');
    await type('quick-title', 'x'.repeat(201));
    await save();
    expect(rig.sync.enqueued).toEqual([]);
    expect(screen.getByTestId('quick-phone-error')).toBeOnTheScreen();
    expect(screen.getByTestId('quick-last-name-error')).toHaveTextContent(pl.quickOrder.errors.lastName.single_word);
    expect(screen.getByTestId('quick-postal-error')).toHaveTextContent(pl.quickOrder.errors.postalCode.format);
    expect(screen.getByTestId('quick-title-error')).toHaveTextContent('Tytuł jest za długi. Może mieć najwyżej 200 znaków.');
    // fixing one field removes its error at once
    await type('quick-postal', '05-500');
    expect(screen.queryByTestId('quick-postal-error')).toBeNull();
  });

  it('EVM-106 AC3: a note over 2000 characters is refused at the field', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fillNewHouse();
    await type('quick-note', 'n'.repeat(2001));
    await save();
    expect(rig.sync.enqueued).toEqual([]);
    expect(screen.getByTestId('quick-note-error')).toHaveTextContent('Notatka jest za długa. Może mieć najwyżej 2000 znaków.');
  });

  it('EVM-106 AC3: a new customer with the phone of a customer of the phone: the hint, a question before saving once, "Wybierz" takes the existing one', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    await type('quick-first-name', 'Janek');
    await type('quick-last-name', 'Inny');
    await type('quick-phone', '+48600000001');
    expect(
      within(screen.getByTestId('quick-similar-c-1')).getByText('W telefonie jest podobny klient: Jan Przykładowy · +48 600 000 001'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-site-pick-s-1'));
    await fireEvent.press(screen.getByTestId(`quick-template-${T_GARAGE}`));
    await save();
    // nothing was queued: the question comes first
    expect(rig.sync.enqueued).toEqual([]);
    expect(within(screen.getByTestId('quick-similar-c-1')).getByText(pl.quickOrder.similarConfirm)).toBeOnTheScreen();
    // the screen reader gets the question in the focused summary, not an empty element
    expect(within(screen.getByTestId('quick-order-summary')).getByText(pl.quickOrder.similarConfirm)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-similar-pick-c-1'));
    await save();
    expect(screen.queryByTestId('quick-order-summary-similar')).toBeNull();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(payloadOf(rig)).toMatchObject({ customerId: 'c-1' });
    expect(payloadOf(rig)).not.toHaveProperty('newCustomer');
  });

  it('EVM-106 AC3: the same name without Polish letters and case is similar; pressing "Zapisz" again after the question creates the new customer', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    await type('quick-first-name', 'JAN');
    await type('quick-last-name', 'przykladowy');
    await type('quick-phone', '700 000 001');
    expect(screen.getByTestId('quick-similar-c-1')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-site-pick-s-1'));
    await fireEvent.press(screen.getByTestId(`quick-template-${T_GARAGE}`));
    await save();
    expect(rig.sync.enqueued).toEqual([]);
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    expect(payloadOf(rig)).toMatchObject({ newCustomer: { displayName: 'JAN przykladowy' } });
  });

  it('EVM-106 AC3: the lookup is local - a similar customer needs no request and a different customer shows no hint', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    await type('quick-first-name', 'Ewa');
    await type('quick-last-name', 'Zupełnie');
    await type('quick-phone', '+48 511 111 111');
    expect(screen.queryByTestId('quick-similar-c-1')).toBeNull();
  });
});

describe('closing and discarding', () => {
  it('EVM-106 AC2: "Zamknij" of an untouched form closes it; with data it asks first, and "Odrzuć" drops everything', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-new-order'));
    await settle();
    await type('quick-first-name', 'Anna');
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    expect(screen.getByTestId('quick-order-discard-dialog')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-order-discard-back'));
    expect(screen.getByTestId('quick-first-name').props.value).toBe('Anna');
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    await fireEvent.press(screen.getByTestId('quick-order-discard-confirm'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
    // no draft: a new opening is empty
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-new-order'));
    await settle();
    expect(screen.getByTestId('quick-first-name').props.value).toBe('');
  });

  it('EVM-106 AC2: the system Back asks before it drops typed data', async () => {
    const rig = rigWith();
    const handlers: (() => boolean)[] = [];
    const add = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => undefined };
    });
    await openForm(rig);
    await type('quick-first-name', 'Anna');
    const last = handlers.at(-1);
    await act(async () => {
      last?.();
      await Promise.resolve();
    });
    expect(screen.getByTestId('quick-order-discard-dialog')).toBeOnTheScreen();
    add.mockRestore();
  });
});

describe('privacy (EVM-106 AC6; security K4-K7)', () => {
  it('EVM-106 AC6: the fields of a name, phone and address have autofill, autocomplete, autocorrect and spell check off; the title has autofill off; the note keeps autocorrect', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    await fireEvent.press(screen.getByTestId('quick-site-new'));
    await fireEvent.press(screen.getByTestId('quick-site-type'));
    await fireEvent.press(screen.getByTestId('quick-site-type-multi_family_garage'));
    for (const id of [
      'quick-first-name',
      'quick-last-name',
      'quick-phone',
      'quick-street',
      'quick-building',
      'quick-apartment',
      'quick-postal',
      'quick-city',
      'quick-spot',
      'quick-title',
    ]) {
      const props = screen.getByTestId(id).props as Record<string, unknown>;
      expect([
        id,
        props['autoCorrect'],
        props['spellCheck'],
        props['autoComplete'],
        props['importantForAutofill'],
        props['textContentType'],
      ]).toEqual([id, false, false, 'off', 'no', 'none']);
    }
    await fireEvent.press(screen.getByTestId('quick-customer-existing'));
    for (const id of ['quick-customer-search']) {
      const props = screen.getByTestId(id).props as Record<string, unknown>;
      expect([props['autoCorrect'], props['spellCheck'], props['autoComplete'], props['importantForAutofill']]).toEqual([
        false,
        false,
        'off',
        'no',
      ]);
    }
    const note = screen.getByTestId('quick-note').props as Record<string, unknown>;
    expect([note['autoCorrect'], note['spellCheck'], note['autoComplete'], note['importantForAutofill']]).toEqual([
      true,
      true,
      'off',
      'no',
    ]);
    // the phone has the phone keyboard
    await fireEvent.press(screen.getByTestId('quick-customer-new'));
    expect((screen.getByTestId('quick-phone').props as Record<string, unknown>)['keyboardType']).toBe('phone-pad');
  });

  it('EVM-106 AC6: the hidden-data mode drops an open form at once, and on return the form is empty (no draft)', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('quick-first-name', 'Anna');
    await type('quick-phone', '600 000 009');
    await hide(rig);
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(screen.queryByDisplayValue('Anna')).toBeNull();
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-new-order'));
    await settle();
    expect(screen.getByTestId('quick-first-name').props.value).toBe('');
    expect(screen.getByTestId('quick-phone').props.value).toBe('');
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-106 AC6: in the hidden-data mode "Nowe zlecenie" is unavailable with the reason and "Zdjęcia możesz robić dalej", and nothing is read', async () => {
    const rig = rigWith(TEMPLATES, PHONE_SOURCE);
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    expect(screen.getByTestId('add-new-order')).toBeDisabled();
    expect(screen.getByTestId('add-hidden-quick')).toHaveTextContent(
      'Nowe zlecenie założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej.',
    );
    expect(screen.getByTestId('add-media')).toBeEnabled();
    expect(rig.sync.quickSourceRequests).toEqual([]);
  });

  it('EVM-106 AC6: nothing is written to the console, to the announcements or to the toast with the typed data (fixed texts only)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const rig = rigWith();
    rig.sync.result = { ok: false, code: 'storage_failure' };
    await openForm(rig);
    await fillNewHouse();
    await save();
    rig.sync.result = { ok: true };
    await save();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const spoken = JSON.stringify(announce.mock.calls);
    expect(spoken).not.toMatch(/Anna|Fikcyjna|600 000 009|Testowa|Piaseczno/);
    expect(screen.queryByText(/Anna|Fikcyjna|600 000 009|Testowa/)).toBeNull();
    spies.forEach((spy) => {
      spy.mockRestore();
    });
  });

  it('EVM-106 AC6: a failed read of the phone data is a fixed message, not a crash', async () => {
    const rig = rigWith();
    rig.sync.quickOrderSource = () => Promise.reject(new Error('Jan Przykładowy'));
    await openForm(rig);
    expect(screen.getByTestId('quick-order-error')).toBeOnTheScreen();
    expect(screen.getByText(pl.quickOrder.loadFailed)).toBeOnTheScreen();
  });
});

const WO = '0194c2a0-0000-7000-8000-0000000000c1';
const PENDING: OrderDetail = {
  id: WO,
  number: null,
  title: 'Dom — sam montaż',
  status: 'new',
  awaitingNumber: true,
  templateName: 'Dom — sam montaż',
  note: 'Oględziny w piątek',
  pendingMutationId: '0194c2a0-0000-7000-8000-0000000000d1',
  customer: { name: 'Anna Fikcyjna', phone: '600 000 009', dial: '600000009' },
  location: { street: 'ul. Testowa 5', city: '05-500 Piaseczno', spot: null, level: null, powerKw: null, operator: null, manager: null },
  scope: [],
  processes: [],
  journal: [
    {
      id: 'n1',
      source: 'pending',
      kind: 'note',
      category: 'other',
      author: null,
      at: 5,
      body: 'Wpis czeka',
      redacted: false,
      superseded: false,
      correction: false,
      awaitsOrder: true,
    },
  ],
};
const queued: QueueRecord = {
  mutationId: PENDING.pendingMutationId ?? '',
  type: 'CreateQuickWorkOrder',
  commandVersion: 1,
  payload: {
    workOrderId: WO,
    title: PENDING.title,
    newCustomer: { displayName: 'Anna Fikcyjna' },
    newSite: { street: 'ul. Testowa', buildingNumber: '5', city: 'Piaseczno' },
  },
  objectId: WO,
  orderingKey: WO,
  createdAt: 1,
  ownerUserId: 'u1',
  state: 'pending',
  attempts: 0,
};

describe('the order waiting for its number (EVM-106 AC2, AC4)', () => {
  const waiting = (): PortsRig => {
    const rig = rigWith();
    rig.sync.rows = buildOrderList({ orders: [], customers: [], sites: [], stages: [] }, [queueFact(queued, true)]);
    rig.sync.details.set(WO, PENDING);
    return rig;
  };

  it('EVM-106 AC2: the row on the list opens the details from the queue - the badge, the banner, the template, the note and the entry that waits for the order', async () => {
    const rig = waiting();
    await open(rig);
    await fireEvent.press(screen.getByTestId(`order-row-${WO}`));
    await settle();
    expect(screen.getByTestId('order-detail-awaiting')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-pending-banner')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-template')).toHaveAccessibleName('Szablon: Dom — sam montaż');
    expect(screen.getByTestId('order-detail-note')).toHaveAccessibleName('Notatka: Oględziny w piątek');
    expect(screen.queryByTestId('order-detail-status')).toBeNull();
    expect(screen.queryByTestId('order-detail-processes')).toBeNull();
    expect(within(screen.getByTestId('order-detail-entry-n1')).getByText('Wyślemy po utworzeniu zlecenia')).toBeOnTheScreen();
  });

  it('EVM-106 AC2: an entry added to the waiting order waits in the queue behind the order (the parent is the mutation of the order)', async () => {
    const rig = waiting();
    await open(rig);
    await fireEvent.press(screen.getByTestId(`order-row-${WO}`));
    await settle();
    await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
    await settle();
    await fireEvent.changeText(screen.getByTestId('entry-body'), 'Wpis do nowego zlecenia');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await settle();
    expect(rig.sync.enqueued[0]).toMatchObject({
      type: 'CreateNote',
      parentMutationId: PENDING.pendingMutationId,
      payload: { workOrderId: WO },
    });
  });

  it('EVM-106 AC4: when the order gets its number the same screen turns into the synchronized order and the number is announced once, without data', async () => {
    const rig = waiting();
    await open(rig);
    await fireEvent.press(screen.getByTestId(`order-row-${WO}`));
    await settle();
    expect(announce).not.toHaveBeenCalled();
    rig.sync.details.set(WO, {
      ...PENDING,
      number: 'ZL-2026-0099',
      awaitingNumber: false,
      status: 'new',
      note: null,
      journal: [],
    });
    await act(() => {
      rig.sync.set({ lastSuccessAt: 123_456 });
    });
    await settle();
    expect(screen.queryByTestId('order-detail-awaiting')).toBeNull();
    expect(screen.getByTestId('order-detail-status')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Zlecenie dostało numer ZL-2026-0099.');
    // a further refresh does not announce it again
    await act(() => {
      rig.sync.set({ lastSuccessAt: 234_567 });
    });
    await settle();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('EVM-106 AC4: an order opened already numbered is not announced', async () => {
    const rig = waiting();
    rig.sync.details.set(WO, { ...PENDING, number: 'ZL-2026-0099', awaitingNumber: false, journal: [] });
    await open(rig);
    await fireEvent.press(screen.getByTestId(`order-row-${WO}`));
    await settle();
    expect(announce).not.toHaveBeenCalled();
  });
});
