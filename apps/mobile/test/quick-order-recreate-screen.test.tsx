import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { EMPTY_DRAFT, type QuickOrderDraft } from '../src/orders/quick-order-model';
import type { OrderDetail } from '../src/orders/order-detail-model';
import type { TemplateSet } from '../src/orders/templates';
import { type StartupChecker } from '../src/startup';
import type { QueueItem, RecreateSource } from '../src/sync/types';
import { stubPorts, type PortsRig } from './session-helpers';

// EVM-128 AC1, AC2, AC3, AC4, AC5 (+ security K3, K4): the form "Utwórz ponownie" of a rejected quick work order. Synthetic data only.
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
const SYNTHETIC = /Anna|Fikcyjna|600 000 009|Testowa|Piaseczno|Oględziny|Tytuł-zlecenia-X/;
const DRAFT: QuickOrderDraft = {
  ...EMPTY_DRAFT,
  firstName: 'Anna',
  lastName: 'Fikcyjna',
  phone: '600 000 009',
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '5',
  postalCode: '05-500',
  city: 'Piaseczno',
  templateId: T_HOUSE,
  title: 'Tytuł-zlecenia-X',
  note: 'Oględziny w piątek',
};
const AT = Date.UTC(2026, 10, 2, 8, 12);
const ID = 'm-1';
/** The element's text contains this string (an alert has several lines). */
const contains = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const quickItem = (patch: Partial<QueueItem> = {}): QueueItem => ({
  id: ID,
  type: 'CreateQuickWorkOrder',
  state: 'attention',
  createdAt: AT,
  targetId: null,
  code: 'validation_failed',
  attempts: 1,
  reason: 'validation_failed_quick',
  actions: ['recreate', 'discard'],
  dependents: 3,
  label: null,
  ...patch,
});
const source = (patch: Partial<RecreateSource> = {}, draft: Partial<QuickOrderDraft> = {}): RecreateSource => ({
  draft: { ...DRAFT, ...draft },
  code: 'validation_failed',
  dependents: 3,
  ...patch,
});

async function openQueue(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
  await settle();
}
const rigWith = (item: Partial<QueueItem> = {}, src: RecreateSource | null = source()): PortsRig => {
  const rig = stubPorts();
  rig.sync.templateSet = TEMPLATES;
  rig.sync.items = [quickItem(item)];
  if (src !== null) rig.sync.recreateSources.set(ID, src);
  return rig;
};
const openForm = async (rig: PortsRig) => {
  await openQueue(rig);
  await fireEvent.press(screen.getByTestId(`attention-${ID}-recreate`));
  await settle();
};
const type = async (testID: string, value: string) => {
  await fireEvent.changeText(screen.getByTestId(testID), value);
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
const checked = (templateId: string): boolean | undefined =>
  (screen.getByTestId(`quick-template-${templateId}`).props as { accessibilityState?: { checked?: boolean } }).accessibilityState?.checked;

let announce: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('the form with the data and the reason (EVM-128 AC1)', () => {
  it('EVM-128 AC1: "Utwórz ponownie" of a rejected quick order opens M-10 with the data of the command, and nothing is saved by the opening', async () => {
    const rig = rigWith();
    await openForm(rig);
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
    expect(rig.sync.recreateSourceRequests).toEqual([ID]);
    expect(screen.getByTestId('quick-first-name').props.value).toBe('Anna');
    expect(screen.getByTestId('quick-last-name').props.value).toBe('Fikcyjna');
    expect(screen.getByTestId('quick-phone').props.value).toBe('600 000 009');
    expect(screen.getByTestId('quick-street').props.value).toBe('ul. Testowa');
    expect(screen.getByTestId('quick-postal').props.value).toBe('05-500');
    expect(screen.getByTestId('quick-title').props.value).toBe('Tytuł-zlecenia-X');
    expect(screen.getByTestId('quick-note').props.value).toBe('Oględziny w piątek');
    expect(checked(T_HOUSE)).toBe(true);
    expect(rig.sync.recreated).toEqual([]);
    expect(rig.sync.enqueued).toEqual([]);
  });

  it('EVM-128 AC1: the reason on top - the text of the rejection and the number of entries that will move (validation_failed)', async () => {
    const rig = rigWith();
    await openForm(rig);
    const alert = screen.getByTestId('quick-order-recreate-alert');
    expect(alert).toHaveTextContent(contains(pl.quickOrder.recreate.reasonDefault));
    expect(pl.quickOrder.recreate.reasonDefault).toBe('Zlecenie nie zostało utworzone — sprawdź dane klienta i adres.');
    expect(alert).toHaveTextContent(contains('Zdjęcia i wpisy (3) przeniesiemy do nowego zlecenia.'));
  });

  it('EVM-128 AC1: for id_conflict the reason is "zapisz go jeszcze raz"; with no entries there is no sentence about moving them', async () => {
    const rig = rigWith({ code: 'id_conflict', reason: 'id_conflict', dependents: 0 }, source({ code: 'id_conflict', dependents: 0 }));
    await openForm(rig);
    const alert = screen.getByTestId('quick-order-recreate-alert');
    expect(alert).toHaveTextContent(contains('Ten element nie mógł zostać zapisany — zapisz go jeszcze raz.'));
    expect(alert).not.toHaveTextContent(/przeniesiemy/);
  });

  it('EVM-128 AC1: the reason of template_unavailable is the general one (the template has its own notice)', async () => {
    const rig = rigWith(
      { code: 'template_unavailable', reason: 'template_unavailable' },
      source({ code: 'template_unavailable' }, { templateId: null }),
    );
    await openForm(rig);
    expect(screen.getByTestId('quick-order-recreate-alert')).toHaveTextContent(contains(pl.quickOrder.recreate.reasonDefault));
  });

  it('EVM-128 AC1: validation_failed runs the local validation at once - the summary of the errors; the fields are not marked by the server', async () => {
    const rig = rigWith({}, source({}, { postalCode: '', phone: '' }));
    await openForm(rig);
    const summary = screen.getByTestId('quick-order-errors');
    expect(within(summary).getByText(/Podaj kod pocztowy/)).toBeOnTheScreen();
    expect(within(summary).getByText(/Podaj numer telefonu/)).toBeOnTheScreen();
    expect(rig.sync.recreated).toEqual([]);
  });

  it('EVM-128 AC1: other codes do not start the validation (no errors before the technician touches "Zapisz")', async () => {
    const rig = rigWith({ code: 'quota_exceeded', reason: 'quota_exceeded' }, source({ code: 'quota_exceeded' }, { postalCode: '' }));
    await openForm(rig);
    expect(screen.queryByTestId('quick-order-errors')).toBeNull();
    expect(screen.queryByTestId('quick-postal-error')).toBeNull();
    expect(screen.getByTestId('quick-order-recreate-alert')).toHaveTextContent(contains(pl.quickOrder.recreate.reasonDefault));
  });

  it('EVM-128 AC1: a source that is not available (nothing, or the read fails) shows the error; the queue is not touched', async () => {
    const empty = rigWith({}, null);
    await openForm(empty);
    expect(screen.getByTestId('quick-order-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('quick-first-name')).toBeNull();
    expect(empty.sync.recreated).toEqual([]);
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(empty.sync.calls.filter((call) => /^(discard|recreate|retarget):/.test(call))).toEqual([]);
  });

  it('EVM-128 AC1: a read of the source that fails shows the same error', async () => {
    const failing = rigWith();
    failing.sync.recreateSourceHook = () => Promise.reject(new Error('boom'));
    await openForm(failing);
    expect(screen.getByTestId('quick-order-error')).toBeOnTheScreen();
    expect(failing.sync.recreated).toEqual([]);
  });

  it('EVM-128 AC1: the source of the quick order is read for the entry that was touched, and the data are not in a navigation parameter, a log or a label', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const rig = rigWith();
    await openForm(rig);
    await type('quick-first-name', 'Zmieniona');
    await save();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(rig.sync.calls.filter((call) => SYNTHETIC.test(call))).toEqual([]);
    expect(announce.mock.calls.flat().join(' ')).not.toMatch(SYNTHETIC);
  });
});

describe('the template that is gone (EVM-128 AC2)', () => {
  const gone = () =>
    rigWith(
      { code: 'template_unavailable', reason: 'template_unavailable' },
      source({ code: 'template_unavailable' }, { templateId: null }),
    );

  it('EVM-128 AC2: the template is deselected, the notice stands under "Szablon", the title of the command stays', async () => {
    const rig = gone();
    await openForm(rig);
    expect(checked(T_HOUSE)).toBe(false);
    expect(
      within(screen.getByTestId('quick-template')).getByText('Poprzedni szablon nie jest już dostępny. Wybierz nowy.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('quick-title').props.value).toBe('Tytuł-zlecenia-X');
  });

  it('EVM-128 AC2: choosing a template removes the notice and does not overwrite the title', async () => {
    const rig = gone();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId(`quick-template-${T_HOUSE}`));
    expect(screen.queryByTestId('quick-template-gone')).toBeNull();
    expect(checked(T_HOUSE)).toBe(true);
    expect(screen.getByTestId('quick-title').props.value).toBe('Tytuł-zlecenia-X');
  });

  it('EVM-128 AC2: saving without a template is not possible - the validation names it and nothing is written', async () => {
    const rig = gone();
    await openForm(rig);
    await save();
    expect(within(screen.getByTestId('quick-order-errors')).getByText(/Wybierz szablon\./)).toBeOnTheScreen();
    expect(rig.sync.recreated).toEqual([]);
  });
});

describe('the save (EVM-128 AC3)', () => {
  const detail = (workOrderId: string): OrderDetail => ({
    id: workOrderId,
    number: null,
    title: 'Tytuł-zlecenia-X',
    status: 'new',
    awaitingNumber: true,
    templateName: 'Dom — sam montaż',
    note: null,
    customer: { name: 'Beata Zmieniona', phone: '500 100 200', dial: '500100200' },
    location: { street: 'ul. Nowa 5', city: '05-500 Konstancin', spot: null, level: null, powerKw: null, operator: null, manager: null },
    scope: [],
    processes: [],
    journal: [],
  });

  it('EVM-128 AC3: "Zapisz" gives the corrected data to the ONE operation of the queue (not to enqueue) with the id of the rejected command; the ids are new', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('quick-first-name', 'Beata');
    await type('quick-last-name', 'Zmieniona');
    await save();
    expect(rig.sync.enqueued).toEqual([]);
    expect(rig.sync.recreated).toHaveLength(1);
    const call = rig.sync.recreated[0];
    expect(call?.id).toBe(ID);
    const payload = call?.payload as {
      workOrderId: string;
      templateId: string;
      title: string;
      newCustomer: { id: string; displayName: string };
    };
    expect(payload).toMatchObject({ templateId: T_HOUSE, title: 'Tytuł-zlecenia-X' });
    expect(payload.newCustomer.displayName).toBe('Beata Zmieniona');
    expect(payload.workOrderId).toMatch(/^[0-9a-f]{8}-/);
  });

  it('EVM-128 AC3: after the answer ok the form closes, the toast and the announcement say "Zapisano ponownie…", the order opens with "Oczekuje na numer"', async () => {
    const rig = rigWith();
    await openForm(rig);
    rig.sync.recreateHook = (_id, payload) => {
      rig.sync.details.set(String(payload['workOrderId']), detail(String(payload['workOrderId'])));
      return Promise.resolve({ ok: true });
    };
    await type('quick-first-name', 'Beata');
    await save();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(
      within(screen.getByTestId('quick-order-toast')).getByText('Zapisano ponownie w telefonie. Numer nadamy po synchronizacji.'),
    ).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(pl.quickOrder.recreate.saved);
    expect(within(screen.getByTestId('order-detail-awaiting')).getByText('Oczekuje na numer')).toBeOnTheScreen();
  });

  it('EVM-128 AC3: one touch = one operation - a second touch before the answer adds nothing', async () => {
    const rig = rigWith();
    let confirm: (value: { ok: true }) => void = () => undefined;
    rig.sync.recreateHook = () =>
      new Promise((resolve) => {
        confirm = resolve;
      });
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    await fireEvent.press(screen.getByTestId('quick-order-save'));
    await settle();
    expect(rig.sync.recreated).toHaveLength(1);
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
    await act(async () => {
      confirm({ ok: true });
      await Promise.resolve();
    });
    await settle();
    expect(rig.sync.recreated).toHaveLength(1);
  });

  it('EVM-128 AC3: the similar-customer question of M-10 is asked the same way (a local hint) before the operation', async () => {
    const rig = rigWith();
    rig.sync.quickSource = { customers: [{ id: 'c-9', kind: 'person', displayName: 'Anna Fikcyjna', phone: '600 000 009' }], sites: [] };
    await openForm(rig);
    await save();
    expect(screen.getByTestId('quick-order-summary-similar')).toBeOnTheScreen();
    expect(rig.sync.recreated).toEqual([]);
    await save();
    expect(rig.sync.recreated).toHaveLength(1);
  });
});

describe('the error and the closing (EVM-128 AC4)', () => {
  it.each([['storage_failure'], ['not_attention'], ['no_session']])(
    'EVM-128 AC4: a failed operation (%s) says the old order stays unchanged, and the data stay in the form',
    async (code) => {
      const rig = rigWith();
      await openForm(rig);
      rig.sync.result = { ok: false, code };
      await type('quick-first-name', 'Beata');
      await save();
      expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('quick-order-alert')).getByText('Nie udało się zapisać ponownie. Odrzucone zlecenie zostało bez zmian.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('quick-first-name').props.value).toBe('Beata');
      expect(screen.getByTestId('quick-street').props.value).toBe('ul. Testowa');
      expect(screen.queryByTestId('quick-order-toast')).toBeNull();
    },
  );

  it('EVM-128 AC4: a command that is too large keeps its own message; a rejected promise is the same "bez zmian" message', async () => {
    const rig = rigWith();
    await openForm(rig);
    rig.sync.result = { ok: false, code: 'payload_too_large' };
    await save();
    expect(within(screen.getByTestId('quick-order-alert')).getByText(pl.quickOrder.errors.too_large)).toBeOnTheScreen();
    rig.sync.recreateHook = () => Promise.reject(new Error('boom'));
    await save();
    expect(within(screen.getByTestId('quick-order-alert')).getByText(pl.quickOrder.recreate.failed)).toBeOnTheScreen();
    expect(screen.getByTestId('quick-order')).toBeOnTheScreen();
  });

  it('EVM-128 AC4: closing an untouched form needs no question and changes nothing in the queue (the form was only a reading)', async () => {
    const rig = rigWith();
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(screen.queryByTestId('quick-order-discard-dialog')).toBeNull();
    expect(rig.sync.recreated).toEqual([]);
    expect(rig.sync.calls.filter((call) => /^(discard|recreate|retarget):/.test(call))).toEqual([]);
    expect(screen.getByTestId(`attention-${ID}`)).toBeOnTheScreen();
  });

  it('EVM-128 AC4: closing with changes asks "Porzucić zmiany?" - "Wróć" keeps the data, "Odrzuć" leaves the rejected order in the queue untouched', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('quick-street', 'ul. Inna');
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    const dialog = screen.getByTestId('quick-order-discard-dialog');
    expect(within(dialog).getByText('Porzucić zmiany?')).toBeOnTheScreen();
    expect(within(dialog).getByText('Odrzucone zlecenie zostanie w kolejce.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('quick-order-discard-back'));
    expect(screen.getByTestId('quick-street').props.value).toBe('ul. Inna');
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    await fireEvent.press(screen.getByTestId('quick-order-discard-confirm'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(rig.sync.recreated).toEqual([]);
    expect(rig.sync.calls.filter((call) => /^(discard|recreate|retarget):/.test(call))).toEqual([]);
    expect(screen.getByTestId(`attention-${ID}`)).toBeOnTheScreen();
  });

  it('EVM-128 AC4: the system Back asks the same question when the data changed', async () => {
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => undefined };
    });
    const rig = rigWith();
    await openForm(rig);
    await type('quick-city', 'Inne');
    await act(async () => {
      handlers.at(-1)?.();
      await Promise.resolve();
    });
    expect(screen.getByTestId('quick-order-discard-dialog')).toHaveTextContent(contains('Porzucić zmiany?'));
  });

  it('EVM-128 AC4: a change that is typed back to the original is no change (no question)', async () => {
    const rig = rigWith();
    await openForm(rig);
    await type('quick-street', 'ul. Inna');
    await type('quick-street', 'ul. Testowa');
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    expect(screen.queryByTestId('quick-order')).toBeNull();
  });
});

describe('the hidden-data mode (EVM-128 AC5)', () => {
  it('EVM-128 AC5: the form open when the mode turns on closes at once; no datum of the command stays in the tree; nothing is written', async () => {
    const rig = rigWith();
    await openForm(rig);
    await hide(rig);
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(SYNTHETIC);
    expect(rig.sync.recreated).toEqual([]);
  });

  it('EVM-128 AC5 (K3): a source that answers AFTER the mode turned on is dropped - no data in the tree, and no form', async () => {
    const rig = rigWith();
    let release: (value: RecreateSource | null) => void = () => undefined;
    rig.sync.recreateSourceHook = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId(`attention-${ID}-recreate`));
    await settle();
    await hide(rig);
    await act(async () => {
      release(source());
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(SYNTHETIC);
  });

  it('EVM-128 AC5 (K3): a source that answers after the form was closed does not reopen it or write anything', async () => {
    const rig = rigWith();
    let release: (value: RecreateSource | null) => void = () => undefined;
    rig.sync.recreateSourceHook = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await openForm(rig);
    await fireEvent.press(screen.getByTestId('quick-order-close'));
    await act(async () => {
      release(source());
      await Promise.resolve();
    });
    await settle();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(SYNTHETIC);
    expect(rig.sync.recreated).toEqual([]);
  });

  it('EVM-128 AC5: on the card of the group the action is disabled with the visible reason and an accessible name with it; "Usuń z telefonu" works', async () => {
    const rig = rigWith();
    rig.device.facts.secure = false;
    await openQueue(rig);
    const card = screen.getByTestId(`attention-${ID}`);
    expect(within(card).getByText('Zaloguj się ponownie, aby poprawić dane.')).toBeOnTheScreen();
    const button = screen.getByTestId(`attention-${ID}-recreate`);
    expect(button).toBeDisabled();
    expect(button.props.accessibilityLabel).toBe('Utwórz ponownie. Zaloguj się ponownie, aby poprawić dane.');
    expect(button.props.accessibilityLabel).not.toMatch(/Czeka z nim|zlecenie|elementy/);
    await fireEvent.press(button);
    expect(rig.sync.recreateSourceRequests).toEqual([]);
    expect(screen.getByTestId(`attention-${ID}-discard`)).toBeEnabled();
    await fireEvent.press(screen.getByTestId(`attention-${ID}-discard`));
    await settle();
    await fireEvent.press(screen.getByTestId('discard-confirm'));
    await settle();
    expect(rig.sync.calls).toContain(`discard:${ID}`);
  });

  it('EVM-128 AC5: the action of a note after id_conflict is not touched by the new text (it is not a quick order)', async () => {
    const rig = rigWith({ type: 'CreateNote', targetId: 'wo', code: 'id_conflict', reason: 'id_conflict', dependents: 0 });
    rig.device.facts.secure = false;
    await openQueue(rig);
    expect(screen.queryByText('Zaloguj się ponownie, aby poprawić dane.')).toBeNull();
    expect(screen.getByTestId(`attention-${ID}-recreate`)).toBeEnabled();
  });

  it('EVM-128 AC5: a note or a comment keeps the old "Utwórz ponownie" without the form', async () => {
    const rig = rigWith({ type: 'CreateNote', targetId: 'wo', code: 'id_conflict', reason: 'id_conflict', dependents: 0 });
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId(`attention-${ID}-recreate`));
    await settle();
    expect(rig.sync.calls).toContain(`recreate:${ID}`);
    expect(rig.sync.recreateSourceRequests).toEqual([]);
    expect(screen.queryByTestId('quick-order')).toBeNull();
  });
});
