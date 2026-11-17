import type { QueueRecord } from '@evia/sync-core';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { buildPendingOrderDetail } from '../src/orders/order-detail-model';
import { EMPTY_QUICK_SOURCE } from '../src/orders/quick-order-model';
import { type StartupChecker } from '../src/startup';
import { stubPorts, type PortsRig } from './session-helpers';

// EVM-137 AC1, AC2, AC3, AC5 (security W5, W8, W9): the form of the site survey, its entry in "Dodaj" and the details of a survey that
// waits in the queue. Synthetic data only.
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
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DATA = /Fikcyjna|Piaseczno|05-500|600 000 011/;

async function open(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
const openForm = async (rig: PortsRig) => {
  await open(rig);
  await fireEvent.press(screen.getByTestId('orders-add'));
  await settle();
  await fireEvent.press(screen.getByTestId('add-site-survey'));
  await settle();
};
const type = async (testID: string, value: string) => {
  await fireEvent.changeText(screen.getByTestId(testID), value);
};
const fill = async () => {
  await type('survey-city', 'Piaseczno');
  await type('survey-street', 'ul. Fikcyjna');
  await type('survey-building', '12');
  await type('survey-postal', '05-500');
};
const save = async () => {
  await fireEvent.press(screen.getByTestId('survey-save'));
  await settle();
};
const hide = async (rig: PortsRig, secure = false) => {
  rig.device.facts.secure = secure;
  await act(async () => {
    await rig.device.guard.refresh();
  });
  await settle();
};
/** Like the real service: a survey saved in the queue opens in its details as a survey that waits for a number. */
const serviceLike = (rig: PortsRig) => {
  rig.sync.enqueueHook = (input) => {
    const payload = input.payload as Record<string, unknown>;
    const record = {
      mutationId: 'm-1',
      type: input.type,
      commandVersion: 1,
      payload,
      objectId: String(payload['workOrderId']),
      orderingKey: String(payload['workOrderId']),
      createdAt: 1_794_830_400_000,
      ownerUserId: 'u1',
      state: 'pending',
      attempts: 0,
    } as QueueRecord;
    const detail = buildPendingOrderDetail(String(payload['workOrderId']), [record], EMPTY_QUICK_SOURCE, null);
    if (detail !== null) rig.sync.details.set(String(payload['workOrderId']), detail);
    return Promise.resolve({ ok: true });
  };
};

let announce: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('"Wizja lokalna" in the sheet "Dodaj" (EVM-137 AC1)', () => {
  it('EVM-137 AC1: "Wizja lokalna" is the FIRST action of the sheet, before "Nowe zlecenie", with its one-line explanation', async () => {
    const rig = stubPorts();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    const ids = screen.getAllByTestId(/^add-(site-survey|new-order|entry|media)$/).map((node) => String(node.props.testID));
    expect(ids).toEqual(['add-site-survey', 'add-entry', 'add-new-order', 'add-media']);
    expect(screen.getByTestId('add-site-survey')).toHaveTextContent('Wizja lokalna');
    expect(screen.getByTestId('add-site-survey-hint')).toHaveTextContent('Tylko adres — klienta uzupełni biuro');
  });

  it('EVM-137 AC1: when the server switched the function off (feature_disabled) there is no such action; the rest of the sheet is as before', async () => {
    const rig = stubPorts();
    rig.sync.featureSet = { siteSurveys: false };
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    expect(screen.queryByTestId('add-site-survey')).toBeNull();
    expect(screen.getByTestId('add-new-order')).toBeEnabled();
  });
});

describe('the form (EVM-137 AC1, W8)', () => {
  it('EVM-137 AC1 W8: the form has the address and ONE optional phone - no client, template, title or note (no free-text field for personal data)', async () => {
    const rig = stubPorts();
    await openForm(rig);
    expect(screen.getByTestId('site-survey')).toBeOnTheScreen();
    expect(screen.getByText(pl.siteSurvey.numberInfo)).toBeOnTheScreen();
    const inputs = screen.getAllByTestId(/^survey-(city|street|building|apartment|postal|phone)$/).map((node) => String(node.props.testID));
    expect(inputs).toEqual(['survey-city', 'survey-street', 'survey-building', 'survey-apartment', 'survey-postal', 'survey-phone']);
    expect(screen.queryByTestId('quick-title')).toBeNull();
    expect(screen.queryByTestId('quick-note')).toBeNull();
    expect(screen.queryByTestId('quick-customer-new')).toBeNull();
    expect(screen.queryByText(pl.quickOrder.template)).toBeNull();
  });

  it('EVM-137 AC1 W8: the phone has the hint "Tylko numer — imion i nazwisk nie wpisuj.", the phone keyboard; the term of 90 days is always said', async () => {
    const rig = stubPorts();
    await openForm(rig);
    expect(screen.getByText('Tylko numer — imion i nazwisk nie wpisuj.')).toBeOnTheScreen();
    expect(screen.getByTestId('survey-phone').props.keyboardType).toBe('phone-pad');
    expect(screen.getByTestId('survey-term')).toHaveTextContent(
      'Klienta uzupełni biuro. Wizja bez klienta zostanie usunięta po 90 dniach.',
    );
    expect(screen.getByText('Telefon zamawiającego (opcjonalnie)')).toBeOnTheScreen();
    expect(screen.getByText('Nr lokalu (opcjonalnie)')).toBeOnTheScreen();
  });

  it('EVM-137 AC1 W5: the address fields are private - no autofill, no dictionary of the keyboard', async () => {
    const rig = stubPorts();
    await openForm(rig);
    for (const id of ['survey-city', 'survey-street', 'survey-building', 'survey-apartment', 'survey-postal', 'survey-phone']) {
      const props = screen.getByTestId(id).props as Record<string, unknown>;
      expect([id, props['importantForAutofill'], props['autoComplete']]).toEqual([id, 'no', 'off']);
    }
  });

  it('EVM-137 AC1: an empty form says what is missing (city, street, building number, postal code) and saves nothing; the phone stays quiet', async () => {
    const rig = stubPorts();
    await openForm(rig);
    await save();
    const summary = screen.getByTestId('survey-errors');
    for (const line of [/Podaj miejscowość\./, /Podaj ulicę\./, /Podaj numer budynku\./, /Podaj kod pocztowy, np\. 00-000\./])
      expect(within(summary).getByText(line)).toBeOnTheScreen();
    expect(within(summary).queryByText(/Podaj numer telefonu/)).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-137 AC1: a typed phone that is wrong is an error ("Podaj numer telefonu, np. 600 123 456."), the message never repeats what was typed', async () => {
    const rig = stubPorts();
    await openForm(rig);
    await fill();
    await type('survey-phone', 'Jan Kowalski');
    await save();
    expect(within(screen.getByTestId('survey-errors')).getByText(/Podaj numer telefonu, np\. 600 123 456\./)).toBeOnTheScreen();
    expect(screen.getByTestId('survey-phone-error')).toHaveTextContent('Podaj numer telefonu, np. 600 123 456.');
    expect(screen.queryByText(/Kowalski/)).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
  });
});

describe('saving (EVM-137 AC2, AC3)', () => {
  it('EVM-137 AC2: "Zapisz wizję" puts ONE CreateSiteSurvey into the queue (new UUIDv7, no client, template, title or note), then the details open as "Oczekuje na numer" with the toast', async () => {
    const rig = stubPorts();
    serviceLike(rig);
    await openForm(rig);
    await fill();
    await type('survey-apartment', '4');
    await type('survey-phone', '600 000 011');
    await save();
    expect(rig.sync.enqueued).toHaveLength(1);
    const [command] = rig.sync.enqueued;
    expect(command).toMatchObject({ type: 'CreateSiteSurvey', commandVersion: 1 });
    const payload = (command?.payload ?? {}) as Record<string, unknown>;
    expect(String(payload['workOrderId'])).toMatch(UUID_V7);
    expect(Object.keys(payload).sort()).toEqual(['newSite', 'requesterPhone', 'workOrderId']);
    expect(payload['newSite']).toMatchObject({ siteType: 'other', city: 'Piaseczno', apartmentNumber: '4' });
    expect(screen.queryByTestId('site-survey')).toBeNull();
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-awaiting')).toHaveTextContent('Oczekuje na numer');
    expect(screen.getByTestId('quick-order-toast')).toHaveTextContent('Zapisano w telefonie. Numer nadamy po synchronizacji.');
  });

  it('EVM-137 AC2 AC3: the details of the survey that waits have the address and the phone (the only place), "Brak klienta", no client or process, and the camera is one touch away', async () => {
    const rig = stubPorts();
    serviceLike(rig);
    await openForm(rig);
    await fill();
    await type('survey-phone', '600 000 011');
    await save();
    expect(screen.getByTestId('order-detail-header')).toHaveTextContent('Wizja lokalna');
    expect(screen.getByTestId('order-detail-survey-badge')).toHaveTextContent('Wizja lokalna');
    expect(screen.getByTestId('order-detail-location')).toHaveTextContent(/ul\. Fikcyjna 12, 05-500 Piaseczno/);
    expect(screen.getByTestId('order-detail-survey-phone')).toHaveTextContent(/600 000 011/);
    expect(screen.getByLabelText('Zadzwoń: telefon zamawiającego')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-pending-banner')).toHaveTextContent(
      'Zapisano w telefonie. Numer nadamy po synchronizacji. Możesz już robić zdjęcia i filmy.',
    );
    expect(screen.getByTestId('order-detail-no-customer')).toHaveTextContent(
      'Brak klienta — uzupełni biuro. Biuro przypisze klienta po akceptacji oferty.',
    );
    expect(screen.queryByTestId('order-detail-customer')).toBeNull();
    expect(screen.queryByTestId('order-detail-template')).toBeNull();
    expect(screen.getByTestId('order-detail-take-photo')).toBeEnabled();
  });

  it('EVM-137 AC2: one touch is one command - a second press while the first is being written adds nothing', async () => {
    const rig = stubPorts();
    let release: (value: { ok: true }) => void = () => undefined;
    rig.sync.enqueueHook = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await openForm(rig);
    await fill();
    await fireEvent.press(screen.getByTestId('survey-save'));
    await fireEvent.press(screen.getByTestId('survey-save'));
    expect(rig.sync.enqueued).toHaveLength(1);
    await act(async () => {
      release({ ok: true });
      await Promise.resolve();
    });
  });

  it('EVM-137 AC2: when the queue refuses (no space) the form stays with the data and says why, without the data', async () => {
    const rig = stubPorts();
    rig.sync.result = { ok: false, code: 'storage_failure' };
    await openForm(rig);
    await fill();
    await save();
    expect(screen.getByTestId('survey-alert')).toHaveTextContent('Brak miejsca — wizja zostaje w formularzu.');
    expect(screen.getByTestId('survey-city').props.value).toBe('Piaseczno');
    expect(screen.getByTestId('site-survey')).toBeOnTheScreen();
  });

  it('EVM-137 W5: nothing typed reaches the console or an announcement; the toast is a fixed text', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const rig = stubPorts();
    serviceLike(rig);
    await openForm(rig);
    await fill();
    await type('survey-phone', '600 000 011');
    await save();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(announce.mock.calls)).not.toMatch(DATA);
    expect(screen.getByTestId('quick-order-toast').props.children).toBeDefined();
    expect(screen.queryByTestId('quick-order-toast')).not.toHaveTextContent(DATA);
  });
});

describe('the hidden-data mode (EVM-137 AC5, W9)', () => {
  it('EVM-137 AC5: the row is in the sheet, it opens a notice instead of the form: "Wizję lokalną założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej."; photos stay on', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    expect(screen.getByTestId('add-site-survey')).toBeEnabled();
    expect(screen.getByTestId('add-media')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('add-site-survey'));
    await settle();
    expect(screen.getByTestId('site-survey-hidden-notice')).toHaveTextContent(
      'Wizję lokalną założysz po ponownym zalogowaniu. Zdjęcia możesz robić dalej.',
    );
    expect(screen.queryByTestId('survey-city')).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-137 AC5: the mode turning on drops an open form at once; on return the form is empty (no draft, nothing opens by itself)', async () => {
    const rig = stubPorts();
    await openForm(rig);
    await type('survey-city', 'Piaseczno');
    await type('survey-phone', '600 000 011');
    await hide(rig);
    expect(screen.queryByTestId('site-survey')).toBeNull();
    expect(screen.queryByTestId('site-survey-hidden')).toBeNull();
    expect(screen.queryByDisplayValue('Piaseczno')).toBeNull();
    expect(screen.queryByDisplayValue('600 000 011')).toBeNull();
    await hide(rig, true);
    expect(screen.queryByTestId('site-survey')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    await fireEvent.press(screen.getByTestId('add-site-survey'));
    await settle();
    expect(screen.getByTestId('survey-city').props.value).toBe('');
    expect(screen.getByTestId('survey-phone').props.value).toBe('');
    expect(rig.sync.enqueued).toEqual([]);
  });
});

describe('leaving the form', () => {
  it('EVM-137 AC1: closing a touched form asks first ("Odrzucić wizję?"), an untouched one closes at once', async () => {
    const rig = stubPorts();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('survey-close'));
    expect(screen.queryByTestId('site-survey')).toBeNull();
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    await fireEvent.press(screen.getByTestId('add-site-survey'));
    await settle();
    await type('survey-street', 'x');
    await fireEvent.press(screen.getByTestId('survey-close'));
    expect(within(screen.getByTestId('survey-discard-dialog')).getByText('Wpisane dane nie zostały zapisane i znikną.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('survey-discard-confirm'));
    expect(screen.queryByTestId('site-survey')).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
  });
});
