import { Activity, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Text, TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { buildOrderList, type OrderListSource } from '../src/orders/order-list-model';
import type { OrderDetail } from '../src/orders/order-detail-model';
import type { TemplateSet } from '../src/orders/templates';
import { LockGate } from '../src/screens/LockOverlay';
import { useAllSentAnnouncement } from '../src/screens/use-all-sent-announcement';
import { NOTICE_MS, useNotice } from '../src/screens/use-notice';
import type { StartupChecker } from '../src/startup';
import { EMPTY_COUNTS } from '../src/sync/types';
import { MIN, rig as guardRig } from './device-guard/fakes';
import { cameraMock } from './mocks/expo-camera';
import { stubPorts, type PortsRig } from './session-helpers';

jest.mock('expo-camera', () => jest.requireActual<typeof import('./mocks/expo-camera')>('./mocks/expo-camera'));

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

// EVM-146: the signed-in content under the cover of the lock is not in the view tree (`Activity` hidden) and keeps its state. The view tree that
// adb and the accessibility services read is proved on the emulator (flows 130-lock-view-tree and 131/132 lock-state-kept); the test renderer
// lists a hidden `Activity` anyway, so here the proofs are the ones it can give: the effects of the content are cleaned (the mark of a hidden
// tree), the state is kept, and every screen comes back as it was.

const settle = () =>
  act(async () => {
    for (let n = 0; n < 12; n += 1) await Promise.resolve();
  });
const online: StartupChecker = () => Promise.resolve({ kind: 'online' });

const SOURCE: OrderListSource = {
  orders: [{ id: 'o1', number: 'ZL-2026-0042', status: 'in_progress', createdAt: 1, customerId: 'c1', siteId: 's1' }],
  customers: [{ id: 'c1', displayName: 'Jan Łódzki Synthetic' }],
  sites: [{ id: 's1', street: 'ul. Żółkiewskiego', buildingNumber: '7', city: 'Łódź', parkingSpot: '15' }],
  stages: [],
};
const DETAIL: OrderDetail = {
  id: 'o1',
  number: 'ZL-2026-0042',
  title: 'Garaż — pełny proces',
  status: 'in_progress',
  customer: { name: 'Jan Łódzki Synthetic', phone: '+48 600 100 200', dial: '+48600100200' },
  location: { street: 'ul. Żółkiewskiego 7', city: '00-001 Łódź', spot: '15', level: '-1', powerKw: '40', operator: null, manager: null },
  scope: [],
  processes: [],
  journal: [],
};
const MARKER = 'SYNTHETIC-TYPED-VALUE';

function rigWith(): PortsRig {
  const rig = stubPorts();
  rig.sync.rows = buildOrderList(SOURCE, []);
  rig.sync.details.set('o1', DETAIL);
  return rig;
}
async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}
/** More than 5 minutes in the background lock the app; the system unlock stays unanswered (cancelled). */
async function lock(rig: PortsRig) {
  rig.device.facts.auth = 'cancelled';
  await act(() => {
    rig.device.appState.emit('background');
    rig.device.time.boot += 6 * MIN;
    rig.device.time.wall += 6 * MIN;
    rig.device.appState.emit('active');
  });
  await settle();
  expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
}
async function unlock(rig: PortsRig) {
  rig.device.facts.auth = 'success';
  await fireEvent.press(screen.getByTestId('lock-unlock'));
  await settle();
  expect(screen.queryByTestId('lock-overlay')).toBeNull();
}
const typeIn = async (testID: string, value: string) => {
  await fireEvent.changeText(screen.getByTestId(testID), value);
};
const openEntryForm = async (rig: PortsRig) => {
  await open(rig);
  await fireEvent.press(screen.getByTestId('order-row-o1'));
  await settle();
  await fireEvent.press(screen.getByTestId('order-detail-add-entry'));
  await settle();
};

describe('LockGate: hidden, not unmounted (EVM-146 AC1, AC2)', () => {
  function Probe({ log }: { log: string[] }) {
    const [text, setText] = useState('');
    useEffect(() => {
      log.push('effect-on');
      return () => {
        log.push('effect-off');
      };
    }, [log]);
    return <TextInput testID="probe" value={text} onChangeText={setText} />;
  }
  const appState = guardRig().appState;
  const gate = (locked: boolean, log: string[]) => (
    <LockGate locked={locked} prompting={false} failed={false} appState={appState} onUnlock={() => undefined}>
      <Probe log={log} />
    </LockGate>
  );

  it('EVM-146 AC1: a locked app cleans the effects of its content (a hidden tree), keeps the cover and the second safeguards', async () => {
    const log: string[] = [];
    const view = await render(gate(false, log));
    expect(log).toEqual(['effect-on']);
    await view.rerender(gate(true, log));
    expect(log).toEqual(['effect-on', 'effect-off']);
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    // The second safeguard (the flags of accessibility above) is what `queryByTestId` proves here: the test renderer lists a hidden `Activity` anyway.
    // That the hidden `Activity` takes the tree away is proved by the cleaned effects (the log) and by the emulator flows 130/131/132.
    expect(screen.queryByTestId('probe')).toBeNull(); // out of the accessible tree
  });

  it('EVM-146 AC2: the state of the content survives the lock and the unlock, and the effects run again', async () => {
    const log: string[] = [];
    const view = await render(gate(false, log));
    await fireEvent.changeText(screen.getByTestId('probe'), MARKER);
    await view.rerender(gate(true, log));
    await view.rerender(gate(false, log));
    expect(screen.getByTestId('probe').props.value).toBe(MARKER);
    expect(log).toEqual(['effect-on', 'effect-off', 'effect-on']);
  });
});

describe('the state of the screens comes back after the lock (EVM-146 AC2)', () => {
  it('EVM-146 AC2: the entry form - the same order, the typed text, the chosen category', async () => {
    const rig = rigWith();
    await openEntryForm(rig);
    await fireEvent.press(screen.getByTestId('entry-category-meeting'));
    await typeIn('entry-body', MARKER);
    await lock(rig);
    // `queryByTestId(...) === null` proves the second safeguard (the flags of accessibility); the hidden `Activity` is proved by the cleaned effects and the emulator
    expect(screen.queryByTestId('entry-body')).toBeNull();
    await unlock(rig);
    expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
    expect(screen.getByTestId('entry-category-meeting')).toBeChecked();
    expect(screen.getByTestId('entry-order')).toHaveTextContent(/ZL-2026-0042/);
    expect(rig.sync.calls.filter((call) => call.startsWith('enqueue'))).toEqual([]); // nothing was saved by the lock
  });

  it('EVM-146 AC2: the quick order - the typed fields', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-new-order'));
    await settle();
    await typeIn('quick-first-name', 'Anna');
    await typeIn('quick-street', MARKER);
    await lock(rig);
    await unlock(rig);
    expect(screen.getByTestId('quick-first-name').props.value).toBe('Anna');
    expect(screen.getByTestId('quick-street').props.value).toBe(MARKER);
  });

  it('EVM-146 AC2: the site survey - the typed fields', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await settle();
    await fireEvent.press(screen.getByTestId('add-site-survey'));
    await settle();
    await typeIn('survey-city', 'Piaseczno');
    await typeIn('survey-street', MARKER);
    await lock(rig);
    await unlock(rig);
    expect(screen.getByTestId('survey-city').props.value).toBe('Piaseczno');
    expect(screen.getByTestId('survey-street').props.value).toBe(MARKER);
  });

  it('EVM-146 AC2: the details of the order - the same order is open', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    await lock(rig);
    await unlock(rig);
    expect(screen.getByTestId('order-detail')).toBeOnTheScreen();
    expect(screen.getByTestId('order-detail-header')).toHaveTextContent('Garaż — pełny proces');
  });

  it('EVM-146 AC2: the list - the search text and the filter', async () => {
    const rig = rigWith();
    await open(rig);
    await fireEvent.changeText(screen.getByLabelText(pl.shell.orders.searchLabel), '0042');
    await fireEvent.press(screen.getByTestId('orders-chip-unsent'));
    await settle();
    await lock(rig);
    await unlock(rig);
    expect(screen.getByTestId('orders-search').props.value).toBe('0042');
    expect(screen.getByTestId('orders-chip-unsent').props.accessibilityLabel).toMatch(/wybrane/);
  });
});

describe('sending and the counters do not depend on the content (EVM-146 AC3)', () => {
  it('EVM-146 AC3: the lock does not stop the synchronization; after the unlock the counters show the real state, not the one from before the lock', async () => {
    const rig = rigWith();
    await open(rig, () => Promise.resolve({ kind: 'offline' }));
    expect(rig.sync.calls).toContain('start');
    await act(() => {
      rig.sync.set({ online: false, counts: { ...EMPTY_COUNTS, pending: 1, unsent: 1 } });
    });
    await settle();
    await lock(rig);
    await act(() => {
      rig.sync.set({ online: false, counts: { ...EMPTY_COUNTS, pending: 3, unsent: 3 } }); // the queue grows while the app is locked
    });
    await settle();
    expect(rig.sync.calls).not.toContain('stop'); // the lock does not end the synchronization
    await unlock(rig);
    expect(rig.sync.calls).not.toContain('stop');
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent('Offline · 3');
  });

  it('EVM-146 AC3: "Wszystko wysłane" for a file confirmed while the app was locked is not spoken after the unlock', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    function Files({ count, confirmed }: { count: number; confirmed: number }) {
      useAllSentAnnouncement(count, confirmed, true, 'ALL-SENT');
      return <Text>{count}</Text>;
    }
    const tree = (locked: boolean, count: number, confirmed: number) => (
      <Activity mode={locked ? 'hidden' : 'visible'}>
        <Files count={count} confirmed={confirmed} />
      </Activity>
    );
    const view = await render(tree(false, 1, 0));
    await view.rerender(tree(true, 1, 0));
    await view.rerender(tree(true, 0, 1)); // the last file is confirmed meanwhile
    await view.rerender(tree(false, 0, 1));
    expect(announce).not.toHaveBeenCalled();
    await view.rerender(tree(false, 1, 1));
    await view.rerender(tree(false, 0, 2)); // a confirmation in front of the user is still announced
    expect(announce).toHaveBeenCalledWith('ALL-SENT');
    announce.mockRestore();
    jest.restoreAllMocks();
  });
});

describe('negative cases (EVM-146 AC4)', () => {
  it('EVM-146 AC4: a cancelled, a failed and a repeated unlock keep the content out of reach; only a success opens it', async () => {
    const rig = rigWith();
    await openEntryForm(rig);
    await typeIn('entry-body', MARKER);
    await lock(rig);
    for (const answer of ['cancelled', 'error', 'cancelled'] as const) {
      rig.device.facts.auth = answer;
      await fireEvent.press(screen.getByTestId('lock-unlock'));
      await settle();
      expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
      // the second safeguard (the flags of accessibility), not the hidden `Activity` itself (see the first test and the emulator flows)
      expect(screen.queryByTestId('entry-body')).toBeNull();
      expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
    }
    await unlock(rig);
    expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
  });

  it('EVM-146 AC4: a cold start begins with the cover - the list is out of reach before the first unlock', async () => {
    const rig = rigWith();
    rig.device.facts.auth = 'cancelled';
    await open(rig);
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    // the second safeguard (the flags of accessibility); the hidden `Activity` is proved by the cleaned effects and the emulator flows
    expect(screen.queryByTestId('orders-search')).toBeNull();
    expect(screen.queryByTestId('order-row-o1')).toBeNull();
  });

  it.each([
    ['sign-out', { reason: 'signed_out', unsentItems: 0 }],
    ['a revoked session', { reason: 'session_revoked', unsentItems: 1 }],
    ['an expired session', { reason: 'session_expired', unsentItems: 0 }],
    ['the remote wipe of the company data', { reason: 'device_wipe_required', unsentItems: 2 }],
  ] as const)('EVM-146 AC4: %s while the app is locked removes the content and the typed text for good', async (_name, ended) => {
    const rig = rigWith();
    await openEntryForm(rig);
    await typeIn('entry-body', MARKER);
    await lock(rig);
    await act(() => {
      rig.owner.end(ended);
    });
    await settle();
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    expect(screen.queryByTestId('entry-form', { includeHiddenElements: true })).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain(MARKER);
  });
});

// EVM-146 review round: a hidden `Activity` cleans the effects of the screens and runs them again at the unlock (the state stays).
const T_HOUSE = '0194c2a0-0000-7000-8000-000000000a01';
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
  ],
};
const openQuick = async (rig: PortsRig) => {
  rig.sync.templateSet = TEMPLATES;
  await open(rig);
  await fireEvent.press(screen.getByTestId('orders-add'));
  await fireEvent.press(screen.getByTestId('add-new-order'));
  await settle();
  await typeIn('quick-first-name', 'Anna');
  await typeIn('quick-last-name', 'Fikcyjna');
  await typeIn('quick-phone', '600 000 009');
  await fireEvent.press(screen.getByTestId('quick-site-type'));
  await fireEvent.press(screen.getByTestId('quick-site-type-single_family_house'));
  await typeIn('quick-street', 'ul. Testowa');
  await typeIn('quick-building', '5');
  await typeIn('quick-postal', '05-500');
  await typeIn('quick-city', 'Piaseczno');
  await fireEvent.press(screen.getByTestId(`quick-template-${T_HOUSE}`));
};
const openSurvey = async (rig: PortsRig) => {
  await open(rig);
  await fireEvent.press(screen.getByTestId('orders-add'));
  await settle();
  await fireEvent.press(screen.getByTestId('add-site-survey'));
  await settle();
  await typeIn('survey-city', 'Piaseczno');
  await typeIn('survey-street', 'ul. Fikcyjna');
  await typeIn('survey-building', '12');
  await typeIn('survey-postal', '05-500');
};
const FORMS = [
  ['the entry form', 'entry-form', 'entry-save', async (rig: PortsRig) => openEntryForm(rig)],
  ['the quick order', 'quick-order', 'quick-order-save', openQuick],
  ['the site survey', 'site-survey', 'survey-save', openSurvey],
] as const;

describe('saving after the lock (EVM-146 AC2, review B1)', () => {
  it.each(FORMS)(
    'EVM-146 AC2: %s - a save after the lock and the unlock ends (the form closes, no "saving" for good)',
    async (_n, form, saveId, openForm) => {
      const rig = rigWith();
      await openForm(rig);
      if (form === 'entry-form') await typeIn('entry-body', MARKER);
      await lock(rig);
      await unlock(rig);
      await fireEvent.press(screen.getByTestId(saveId));
      await settle();
      expect(rig.sync.enqueued).toHaveLength(1);
      expect(screen.queryByTestId(form)).toBeNull();
    },
  );

  it.each(FORMS)(
    'EVM-146 AC2: %s - the app locks DURING the save: after the unlock the form is not stuck and nothing is written twice',
    async (_n, form, saveId, openForm) => {
      const rig = rigWith();
      let finish: (() => void) | undefined;
      rig.sync.enqueueHook = () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ ok: true });
          };
        });
      await openForm(rig);
      if (form === 'entry-form') await typeIn('entry-body', MARKER);
      await fireEvent.press(screen.getByTestId(saveId));
      await settle();
      await lock(rig);
      await act(() => {
        finish?.(); // the answer of the queue comes back under the cover
      });
      await settle();
      await unlock(rig);
      expect(screen.queryByTestId(form)).toBeNull();
      expect(rig.sync.enqueued).toHaveLength(1);
    },
  );
});

/** Like the system: the last registered handler is asked first, the first that answers true wins. */
function backStack() {
  const handlers: Parameters<typeof BackHandler.addEventListener>[1][] = [];
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        handlers.splice(handlers.indexOf(handler), 1);
      },
    };
  });
  const back = async (): Promise<boolean> => {
    let handled = false;
    await act(() => {
      for (const handler of [...handlers].reverse()) {
        if (handler(undefined as never)) {
          handled = true;
          break;
        }
      }
    });
    return handled;
  };
  return {
    back,
    restore: () => {
      spy.mockRestore();
    },
  };
}

describe('the system "back" after the unlock does not depend on the order of the effects (EVM-146 AC2, review M2)', () => {
  let stack: ReturnType<typeof backStack>;
  beforeEach(() => {
    cameraMock.reset();
    stack = backStack();
  });
  afterEach(() => {
    stack.restore();
  });

  it('EVM-146 AC2: the entry form with a typed text - "back" after the unlock asks before dropping it; the order below stays open', async () => {
    const rig = rigWith();
    await openEntryForm(rig);
    await typeIn('entry-body', MARKER);
    await lock(rig);
    await unlock(rig);
    expect(await stack.back()).toBe(true);
    expect(screen.getByTestId('entry-discard-dialog')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
    expect(screen.getByTestId('order-detail', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('EVM-146 AC2: an open dialog - "back" after the unlock cancels the dialog, it does not stay open under the handler of the form', async () => {
    const rig = rigWith();
    await openEntryForm(rig);
    await typeIn('entry-body', MARKER);
    expect(await stack.back()).toBe(true);
    expect(screen.getByTestId('entry-discard-dialog')).toBeOnTheScreen();
    await lock(rig);
    await unlock(rig);
    expect(await stack.back()).toBe(true);
    expect(screen.queryByTestId('entry-discard-dialog')).toBeNull();
    expect(screen.getByTestId('entry-body').props.value).toBe(MARKER);
  });

  it('EVM-146 AC3: the camera of the phone is released while the app is locked (the prop `active` does nothing on Android) and taken again at the unlock', async () => {
    const rig = rigWith();
    rig.media.capturePorts = {
      native: {
        importOriginal: () => Promise.resolve('ok'),
        digestOriginal: () => Promise.resolve(null),
        cancelUpload: () => Promise.resolve(true),
      },
      disk: { freeBytes: () => 10_000_000_000 },
      registerAndEnqueue: () => Promise.resolve({ ok: true }),
      now: () => 1,
      newId: () => '0194c2a0-0000-7000-8000-000000000001',
    };
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    await act(async () => {
      await rig.ports.camera.open('o1');
    });
    await settle();
    expect(cameraMock.pauses).toBe(0);
    await lock(rig);
    expect(cameraMock.pauses).toBe(1);
    expect(cameraMock.resumes).toBe(0);
    await unlock(rig);
    expect(cameraMock.resumes).toBe(1);
    expect(cameraMock.pauses).toBe(1);
  });

  it('EVM-146 AC2: the camera - "back" after the unlock closes the camera, not the order under it', async () => {
    const rig = rigWith();
    // the camera is only opened and left here: the ports of a phone are never asked for a picture
    rig.media.capturePorts = {
      native: {
        importOriginal: () => Promise.resolve('ok'),
        digestOriginal: () => Promise.resolve(null),
        cancelUpload: () => Promise.resolve(true),
      },
      disk: { freeBytes: () => 10_000_000_000 },
      registerAndEnqueue: () => Promise.resolve({ ok: true }),
      now: () => 1,
      newId: () => '0194c2a0-0000-7000-8000-000000000001',
    };
    await open(rig);
    await fireEvent.press(screen.getByTestId('order-row-o1'));
    await settle();
    await act(async () => {
      await rig.ports.camera.open('o1');
    });
    await settle();
    expect(screen.getByTestId('camera')).toBeOnTheScreen();
    await lock(rig);
    await unlock(rig);
    expect(await stack.back()).toBe(true);
    await settle();
    expect(screen.queryByTestId('camera')).toBeNull();
    expect(screen.getByTestId('order-detail', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('the announcements and the notices after the unlock (EVM-146 AC2, review m4)', () => {
  it('EVM-146 AC2: "Połączono ponownie" for a connection that came back while the app was locked is not spoken after the unlock', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const rig = rigWith();
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: string) => void);
      return { remove: () => undefined };
    });
    const checker = jest
      .fn<ReturnType<StartupChecker>, []>()
      .mockResolvedValueOnce({ kind: 'offline' })
      .mockResolvedValue({ kind: 'online' });
    await open(rig, checker);
    expect(screen.getByTestId('sync-indicator')).toHaveTextContent(/Offline/);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 3_600_000); // the foreground check is not debounced
    await lock(rig);
    await act(() => {
      for (const listener of listeners) listener('active'); // the check of the startup runs while the lock is shown: the server answers
    });
    await settle();
    await unlock(rig);
    expect(checker.mock.calls.length).toBeGreaterThan(1);
    expect(announce).not.toHaveBeenCalledWith(pl.shell.reconnected);
    announce.mockRestore();
  });
});

describe('a notice with a timer under the lock (EVM-146 AC2, review m4)', () => {
  function Notices() {
    const { notice, say } = useNotice();
    return (
      <>
        <Text
          testID="say"
          onPress={() => {
            say('NOTICE');
          }}
        >
          say
        </Text>
        {notice === null ? null : <Text testID="notice">{notice}</Text>}
      </>
    );
  }
  const tree = (locked: boolean) => (
    <Activity mode={locked ? 'hidden' : 'visible'}>
      <Notices />
    </Activity>
  );

  it('EVM-146 AC2: a notice shown at the lock does not stay for good after the unlock (its timer was cancelled by the cleanup)', async () => {
    jest.useFakeTimers();
    try {
      const view = await render(tree(false));
      await fireEvent.press(screen.getByTestId('say'));
      expect(screen.getByTestId('notice')).toBeOnTheScreen();
      await view.rerender(tree(true));
      await act(() => {
        jest.advanceTimersByTime(10_000);
      });
      await view.rerender(tree(false));
      expect(screen.queryByTestId('notice')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-146 AC2: a notice shown while the screen is in front goes away by itself', async () => {
    jest.useFakeTimers();
    try {
      await render(tree(false));
      await fireEvent.press(screen.getByTestId('say'));
      expect(screen.getByTestId('notice')).toBeOnTheScreen();
      await act(() => {
        jest.advanceTimersByTime(NOTICE_MS + 1);
      });
      expect(screen.queryByTestId('notice')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
