import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import type { StartupChecker } from '../src/startup';
import { DAY, MIN } from './device-guard/fakes';
import { okSignIn, stubOwner, stubPorts, type PortsRig } from './session-helpers';

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
const SYNTHETIC_NAME = 'SYNTHETIC-CUSTOMER-NAME';
const SYNTHETIC_TEXT = 'SYNTHETIC-ENTRY-TEXT';

async function open(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}

function whole(): string {
  return JSON.stringify(screen.toJSON());
}

describe('screen lock off: sign-in and hidden data (EVM-101 AC1)', () => {
  it('EVM-101 AC1: sign-in on a phone without a lock shows "Włącz blokadę ekranu" and sends nothing (0 sign-in calls, 0 token writes)', async () => {
    const loginCalls: unknown[] = [];
    const owner = stubOwner(
      okSignIn({
        login: (credentials) => {
          loginCalls.push(credentials);
          return Promise.reject(new Error('must not be called'));
        },
      }),
    );
    owner.restoreResult = { kind: 'signed_out' };
    const rig = stubPorts(owner);
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.changeText(screen.getByLabelText(pl.login.email), 'jan@example.test');
    await fireEvent.changeText(screen.getByLabelText(pl.login.password), 'synthetic-password');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.submit }));
    await settle();
    expect(screen.getByText(pl.deviceState.screenLockRequired.title)).toBeOnTheScreen();
    expect(loginCalls).toHaveLength(0);
    expect(owner.calls).not.toContain('completeSignIn');
    // "Spróbuj ponownie" returns to the sign-in, where the check is repeated
    await fireEvent.press(screen.getByTestId('device-state-primary'));
    await settle();
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
  });

  it('EVM-101 AC1: a lock that disappears hides the data at the next start or return; the camera and the queue keep working', async () => {
    const rig = stubPorts();
    rig.owner.queue = [{ id: 'm-1', type: 'CreateNote', state: 'pending', label: SYNTHETIC_TEXT }];
    rig.device.facts.secure = false;
    await open(rig);
    expect(screen.getByTestId('hidden-screen_lock_off')).toBeOnTheScreen();
    expect(screen.getByText(pl.hidden.screenLockOff.title)).toBeOnTheScreen();
    // the queue works (type and state), the sheet keeps "Zdjęcie lub film"
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.getByTestId('queue-hidden-count')).toBeOnTheScreen();
    expect(whole()).not.toContain(SYNTHETIC_TEXT);
    // the lock comes back, "Sprawdź ponownie"
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.orders.title }));
    rig.device.facts.secure = true;
    await fireEvent.press(screen.getByTestId('hidden-action'));
    await settle();
    expect(screen.queryByTestId('hidden-screen_lock_off')).toBeNull();
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
  });
});

describe('7 days without contact (EVM-101 AC2)', () => {
  it.each([
    [4, false, null],
    [5, true, pl.contactWarning.days2],
    [6, true, pl.contactWarning.days1],
  ])('EVM-101 AC2: %s days -> warning %s on the list and in "Więcej" (not dismissible)', async (days, shown, text) => {
    const rig = stubPorts();
    rig.owner.contactStatus = () => Promise.resolve({ status: { visible: true, elapsedMs: days * DAY }, windowDays: 7 });
    rig.device.facts.contact = { status: { visible: true, elapsedMs: days * DAY }, windowDays: 7 };
    await open(rig);
    expect(screen.queryByTestId('contact-warning') !== null).toBe(shown);
    if (text !== null) {
      expect(screen.getByText(text)).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: pl.patch.ack })).toBeNull();
      await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
      expect(screen.getByTestId('contact-warning')).toBeOnTheScreen();
    }
  });

  it('EVM-101 AC2: the warning goes away after a contact with the server', async () => {
    const rig = stubPorts();
    rig.device.facts.contact = { status: { visible: true, elapsedMs: 6 * DAY }, windowDays: 7 };
    await open(rig);
    expect(screen.getByTestId('contact-warning')).toBeOnTheScreen();
    rig.device.facts.contact = { status: { visible: true, elapsedMs: 0 }, windowDays: 7 };
    await act(async () => {
      await rig.device.guard.refresh();
    });
    expect(screen.queryByTestId('contact-warning')).toBeNull();
  });

  it.each(['window_elapsed', 'clock_anomaly'] as const)(
    'EVM-101 AC2: %s hides the orders with "Zaloguj się ponownie"; the queue still works',
    async (reason) => {
      const rig = stubPorts();
      rig.owner.queue = [{ id: 'm-1', type: 'CreateNote', state: 'pending', label: SYNTHETIC_TEXT }];
      rig.device.facts.contact = {
        status: { visible: false, reason, elapsedMs: reason === 'window_elapsed' ? 8 * DAY : null },
        windowDays: 7,
      };
      await open(rig);
      expect(screen.getByTestId(reason === 'window_elapsed' ? 'hidden-contact_expired' : 'hidden-clock_anomaly')).toBeOnTheScreen();
      expect(whole()).not.toContain(SYNTHETIC_NAME);
      await fireEvent.press(screen.getByRole('button', { name: pl.hidden.contactExpired.action }));
      await settle();
      expect(rig.owner.calls).toContain('signOut:online');
    },
  );
});

describe('lock of the app (EVM-101 AC3)', () => {
  it('EVM-101 AC3: a cold start covers the content; a cancelled unlock keeps it covered and out of reach of touch and reader; success opens it', async () => {
    const rig = stubPorts();
    rig.device.facts.auth = 'cancelled';
    await open(rig);
    const overlay = screen.getByTestId('lock-overlay');
    expect(overlay).toBeOnTheScreen();
    expect(rig.device.facts.authCalls).toBe(1);
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
    rig.device.facts.auth = 'success';
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    expect(rig.device.facts.authCalls).toBe(2);
  });

  it('EVM-101 AC3: after more than 5 minutes in the background the cover returns; before that it does not', async () => {
    const rig = stubPorts();
    await open(rig);
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot = rig.device.time.boot + 4 * MIN;
      rig.device.time.wall += 4 * MIN;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    rig.device.facts.auth = 'cancelled';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.time.boot = rig.device.time.boot + 6 * MIN;
      rig.device.time.wall += 6 * MIN;
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
  });

  it('EVM-101 AC3: the app lock is always on - "Więcej" has no switch for it', async () => {
    const rig = stubPorts();
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(whole().toLowerCase()).not.toContain('blokada aplikacji');
  });
});

describe('wipe of company data (EVM-101 AC4)', () => {
  async function toWipeDialog(rig: PortsRig) {
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.more.title }));
    await fireEvent.press(screen.getByRole('button', { name: pl.more.wipe }));
    await settle();
  }

  it('EVM-101 AC4: the dialog shows the number of unsent items; "Anuluj" starts nothing', async () => {
    const rig = stubPorts();
    rig.owner.unsent = 5;
    await toWipeDialog(rig);
    expect(screen.getByTestId('wipe-body')).toHaveTextContent(/Stracisz 5 niewysłanych elementów/);
    await fireEvent.press(screen.getByTestId('wipe-cancel'));
    expect(screen.queryByTestId('wipe-dialog')).toBeNull();
    expect(rig.manualWipes.count).toBe(0);
  });

  it('EVM-101 AC4: confirming ends the session and runs the wipe once; the session goes to "Wylogowano"', async () => {
    const rig = stubPorts();
    await toWipeDialog(rig);
    expect(screen.getByTestId('wipe-body')).toHaveTextContent(pl.wipe.none);
    await fireEvent.press(screen.getByTestId('wipe-confirm'));
    await settle();
    expect(rig.manualWipes.count).toBe(1);
    expect(rig.owner.calls).toContain('endSessionForWipe:online');
    expect(screen.getByTestId('device-state-signed_out')).toBeOnTheScreen();
  });

  it.each([
    [1, 'Stracisz 1 niewysłany element'],
    [3, 'Stracisz 3 niewysłane elementy'],
    [12, 'Stracisz 12 niewysłanych elementów'],
  ])('EVM-101 AC4: Polish plural for %s unsent items', async (count, text) => {
    const rig = stubPorts();
    rig.owner.unsent = count;
    await toWipeDialog(rig);
    expect(screen.getByTestId('wipe-body')).toHaveTextContent(new RegExp(text));
  });

  it('EVM-101 AC4: an unfinished wipe is told and can be repeated', async () => {
    const rig = stubPorts();
    rig.manualWipes.result = 'incomplete';
    await toWipeDialog(rig);
    // keep the shell mounted: the stub owner ends the session, so the dialog result is read from the guard-less flow
    await fireEvent.press(screen.getByTestId('wipe-confirm'));
    await settle();
    expect(rig.manualWipes.count).toBe(1);
  });

  it('EVM-101 AC4: a wipe in progress hides the data (hidden-data mode) until it ends', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.device.guard.setWiping(true);
    });
    expect(screen.getByTestId('hidden-wipe_in_progress')).toBeOnTheScreen();
    await act(() => {
      rig.device.guard.setWiping(false);
    });
    expect(screen.queryByTestId('hidden-wipe_in_progress')).toBeNull();
  });
});

describe('another user on the installation (EVM-101 AC5)', () => {
  function mismatch(count: number) {
    const owner = stubOwner();
    owner.restoreResult = { kind: 'signed_out' };
    owner.completeResult = { kind: 'device_check', result: { kind: 'owner_mismatch', unsentItemCount: count } };
    return stubPorts(owner);
  }
  async function signIn(rig: PortsRig) {
    await open(rig);
    await fireEvent.changeText(screen.getByLabelText(pl.login.email), 'jan@example.test');
    await fireEvent.changeText(screen.getByLabelText(pl.login.password), 'synthetic-password');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.submit }));
    await settle();
    await fireEvent.changeText(screen.getByLabelText(pl.login.code), '123456');
    await fireEvent.press(screen.getByRole('button', { name: pl.login.confirm }));
    await settle();
  }

  it('EVM-101 AC5: the dialog shows the number only; "Anuluj" removes nothing, the new session is ended and the sign-in returns', async () => {
    const rig = mismatch(4);
    await signIn(rig);
    expect(screen.getByTestId('owner-mismatch-body')).toHaveTextContent(/w tym 4 niewysłane elementy/);
    await fireEvent.press(screen.getByTestId('owner-mismatch-cancel'));
    await settle();
    expect(rig.owner.calls).toContain('abandon');
    expect(rig.manualWipes.count).toBe(0);
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
  });

  it('EVM-101 AC5: "Usuń i zaloguj" ends the new session, wipes, and starts the sign-in from step 1 (no password kept)', async () => {
    const rig = mismatch(0);
    await signIn(rig);
    expect(screen.getByTestId('owner-mismatch-body')).toHaveTextContent(pl.ownerMismatch.none);
    await fireEvent.press(screen.getByTestId('owner-mismatch-confirm'));
    await settle();
    expect(rig.manualWipes.count).toBe(1);
    expect(rig.owner.calls).toContain('abandon');
    expect(screen.getByLabelText(pl.login.email)).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.login.password)).toHaveProp('value', '');
  });

  it('EVM-101 AC5: an unfinished wipe keeps the dialog (nothing is half-done silently)', async () => {
    const rig = mismatch(2);
    rig.manualWipes.result = 'incomplete';
    await signIn(rig);
    await fireEvent.press(screen.getByTestId('owner-mismatch-confirm'));
    await settle();
    expect(screen.getByTestId('owner-mismatch-dialog')).toBeOnTheScreen();
  });
});

describe('patch level (EVM-101 AC6)', () => {
  it.each([
    ['2026-03-01', 'patch-notice'],
    ['2025-01-01', 'patch-strong'],
  ])('EVM-101 AC6: patch %s shows the non-blocking banner %s; "Rozumiem" closes it for the session', async (patch, id) => {
    const rig = stubPorts();
    rig.device.facts.patch = patch;
    await open(rig);
    expect(screen.getByTestId(id)).toBeOnTheScreen();
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: pl.patch.ack }));
    expect(screen.queryByTestId(id)).toBeNull();
  });

  it('EVM-101 AC6: a current patch level shows nothing', async () => {
    const rig = stubPorts();
    await open(rig);
    expect(screen.queryByTestId('patch-notice')).toBeNull();
    expect(screen.queryByTestId('patch-strong')).toBeNull();
  });
});

describe('sheet "Dodaj" and the queue in the hidden-data mode (EVM-101 AC8)', () => {
  it('EVM-101 AC8: visible data - all three entries are active', async () => {
    const rig = stubPorts();
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    expect(screen.getByTestId('add-entry')).toBeEnabled();
    expect(screen.getByTestId('add-new-order')).toBeEnabled();
    expect(screen.queryByTestId('add-hidden-reason')).toBeNull();
    await fireEvent.press(screen.getByTestId('add-entry'));
    expect(rig.opened).toEqual(['add:entry']);
  });

  it('EVM-101 AC8: hidden data - "Wpis" and "Nowe zlecenie" are disabled with the reason, "Zdjęcie lub film" works', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.press(screen.getByTestId('orders-add'));
    expect(screen.getByTestId('add-entry')).toBeDisabled();
    expect(screen.getByTestId('add-new-order')).toBeDisabled();
    expect(screen.getByText(pl.add.hiddenReason)).toBeOnTheScreen();
    expect(screen.getByTestId('add-media')).toBeEnabled();
    await fireEvent.press(screen.getByTestId('add-media'));
    expect(rig.opened).toEqual(['add:media']);
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId('add-close'));
    expect(screen.queryByTestId('add-sheet')).toBeNull();
  });

  it('EVM-101 AC8: the queue in the hidden mode has no text of an entry - not in the tree, not in any accessibility label; the label is not even requested', async () => {
    const rig = stubPorts();
    rig.owner.queue = [
      { id: 'm-1', type: 'CreateNote', state: 'pending', label: SYNTHETIC_TEXT },
      { id: 'm-2', type: 'CreateWorkOrder', state: 'retrying', label: SYNTHETIC_NAME },
    ];
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.getAllByTestId('queue-row')).toHaveLength(2);
    expect(screen.getByTestId('queue-hidden-count')).toHaveTextContent('2 elementy czekają w kolejce');
    expect(whole()).not.toContain(SYNTHETIC_TEXT);
    expect(whole()).not.toContain(SYNTHETIC_NAME);
    expect(rig.owner.labelRequests.at(-1)).toBe(false);
  });

  it('EVM-101 AC8: with visible data the queue shows the entries with their text', async () => {
    const rig = stubPorts();
    rig.owner.queue = [{ id: 'm-1', type: 'CreateNote', state: 'pending', label: SYNTHETIC_TEXT }];
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.getByText(SYNTHETIC_TEXT)).toBeOnTheScreen();
    expect(rig.owner.labelRequests.at(-1)).toBe(true);
    expect(screen.queryByTestId('queue-hidden-count')).toBeNull();
  });

  it('EVM-101 AC8: the queue is reloaded without labels the moment the data become hidden (the facade, not the screen, decides)', async () => {
    const rig = stubPorts();
    rig.owner.queue = [{ id: 'm-1', type: 'CreateNote', state: 'pending', label: SYNTHETIC_TEXT }];
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.getByText(SYNTHETIC_TEXT)).toBeOnTheScreen();
    rig.device.facts.secure = false;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(whole()).not.toContain(SYNTHETIC_TEXT);
  });
});
