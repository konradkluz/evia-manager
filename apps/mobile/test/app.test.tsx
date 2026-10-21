import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, StyleSheet } from 'react-native';
import { App } from '../src/App';
import { pl } from '../src/i18n/pl';
import { SLOW_CHECK_MS } from '../src/startup';
import type { StartupChecker, StartupState } from '../src/startup';
import { size } from '../src/ui/theme';

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => (
      <actual.SafeAreaInsetsContext.Provider value={metrics.insets}>{children}</actual.SafeAreaInsetsContext.Provider>
    ),
  };
});

const resolved =
  (state: StartupState): StartupChecker =>
  () =>
    Promise.resolve(state);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

async function start(state: StartupState) {
  const view = await render(<App checker={resolved(state)} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('app shell (EVM-009 AC1)', () => {
  it('EVM-009 AC1: the start screen shows the title, the empty list of work orders and the navigation, all from the Polish catalogue', async () => {
    await start({ kind: 'online' });
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: pl.shell.orders.emptyTitle })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.emptyBody)).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: pl.shell.orders.title, selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: pl.shell.queue.title, selected: false })).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.shell.nav.label)).toBeOnTheScreen();
  });

  it('EVM-009 AC1: the literal texts of the story are exactly what the technician sees', () => {
    expect(pl.shell.orders.title).toBe('Moje zlecenia');
    expect(pl.shell.orders.emptyTitle).toBe('Brak zleceń');
    expect(pl.shell.orders.emptyBody).toBe('Zlecenia pojawią się tu po zalogowaniu i synchronizacji.');
    expect(pl.shell.queue.title).toBe('Kolejka');
    expect(pl.shell.queue.emptyTitle).toBe('Nic nie czeka na wysłanie.');
    expect(pl.shell.serverUnavailable.title).toBe('Brak połączenia z serwerem');
    expect(pl.shell.retry).toBe('Spróbuj ponownie');
    expect(pl.update.title).toBe('Zaktualizuj aplikację');
  });

  it('EVM-009 AC1: the shell renders at once with a skeleton while the first check runs, and the navigation is already usable', async () => {
    await render(<App checker={() => new Promise<StartupState>(() => undefined)} />);
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(pl.shell.loading.label)).toBeBusy();
    expect(screen.queryByText(pl.shell.orders.emptyTitle)).toBeNull();
    expect(screen.queryByTestId('sync-indicator')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    expect(screen.getByText(pl.shell.queue.emptyTitle)).toBeOnTheScreen();
  });

  it('EVM-009 AC1: a slow first check adds the "takes longer than usual" note after the limit', async () => {
    jest.useFakeTimers();
    try {
      await render(<App checker={() => new Promise<StartupState>(() => undefined)} />);
      expect(screen.queryByText(pl.shell.loading.slow)).toBeNull();
      await act(() => {
        jest.advanceTimersByTime(SLOW_CHECK_MS);
      });
      expect(screen.getByText(pl.shell.loading.slow)).toBeOnTheScreen();
      expect(screen.getByText(pl.shell.loading.slow)).toHaveProp('accessibilityLiveRegion', 'polite');
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-009 AC1: the bottom navigation switches to the queue and back; the system back button returns from the queue', async () => {
    const handlers: (() => boolean)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: jest.fn() };
    });
    await start({ kind: 'online' });
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    expect(screen.getByRole('header', { name: pl.shell.queue.title })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.queue.emptyTitle)).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: pl.shell.queue.title, selected: true })).toBeOnTheScreen();
    let handled = false;
    await act(() => {
      handled = handlers.at(-1)?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
    await act(() => {
      handled = handlers.at(-1)?.() ?? true;
    });
    expect(handled).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.orders.title }));
    expect(screen.getByRole('tab', { name: pl.shell.orders.title, selected: true })).toBeOnTheScreen();
  });

  it('EVM-009 AC1: all navigation targets and the sync capsule are at least 48 dp', async () => {
    await start({ kind: 'online' });
    for (const tab of screen.getAllByRole('tab')) expect(flat(tab).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    const capsule = screen.getByTestId('sync-indicator');
    expect(flat(capsule).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
  });
});

describe('connection with the API (EVM-009 AC2)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('EVM-009 AC2: with a network and a healthy API the capsule says "Połączono" and no notice is shown', async () => {
    await start({ kind: 'online' });
    expect(screen.getByRole('button', { name: pl.shell.sync.onlineOpenQueue })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.sync.online)).toBeOnTheScreen();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.queryByTestId('server-alert')).toBeNull();
  });

  it('EVM-009 AC2: without a network the app shows the offline banner and capsule and keeps the empty list usable', async () => {
    await start({ kind: 'offline' });
    expect(screen.getByText(pl.shell.offlineBanner)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: pl.shell.sync.offlineOpenQueue })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.sync.offline)).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.emptyTitle)).toBeOnTheScreen();
    expect(screen.queryByTestId('server-alert')).toBeNull();
  });

  it('EVM-009 AC2: the capsule opens the queue and the offline banner stays visible there', async () => {
    await start({ kind: 'offline' });
    await fireEvent.press(screen.getByRole('button', { name: pl.shell.sync.offlineOpenQueue }));
    expect(screen.getByRole('header', { name: pl.shell.queue.title })).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.offlineBanner)).toBeOnTheScreen();
  });

  it('EVM-009 AC2: a server that does not answer shows "Brak połączenia z serwerem" with a retry, and the content stays', async () => {
    await start({ kind: 'serverUnavailable', problem: 'timeout' });
    expect(screen.getByTestId('server-alert')).toHaveProp('accessibilityRole', 'alert');
    expect(screen.getByText(pl.shell.serverUnavailable.title)).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.serverUnavailable.body)).toBeOnTheScreen();
    expect(screen.queryByText(/^Kod:/)).toBeNull();
    // the retry button hugs its label at the start of the alert instead of stretching or centring (touch target stays 48 dp)
    expect(StyleSheet.flatten(screen.getByTestId('retry-server-wrap').props.style as never)).toMatchObject({ alignSelf: 'flex-start' });
    expect(StyleSheet.flatten(screen.getByTestId('retry-server').props.style as never)).toMatchObject({ minHeight: size.touchTarget.min });
    expect(screen.getByText(pl.shell.sync.offline)).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.orders.emptyTitle)).toBeOnTheScreen();
  });

  it('EVM-009 AC2: an unexpected answer adds a support code to the message', async () => {
    await start({ kind: 'serverUnavailable', problem: 'invalid' });
    expect(screen.getByText('Kod: health_invalid')).toBeOnTheScreen();
  });

  it('EVM-009 AC2: "Spróbuj ponownie" repeats the check and the notice disappears when the server answers, with one announcement', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const checker = jest
      .fn<ReturnType<StartupChecker>, []>()
      .mockResolvedValueOnce({ kind: 'serverUnavailable', problem: 'server' })
      .mockResolvedValueOnce({ kind: 'online' });
    await render(<App checker={checker} />);
    await act(async () => {
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByRole('button', { name: pl.shell.retry }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(checker).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('server-alert')).toBeNull();
    expect(screen.getByText(pl.shell.sync.online)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(pl.shell.reconnected);
  });

  it('EVM-009 AC2: no announcement when the app starts online (nothing changed)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    announce.mockClear();
    await start({ kind: 'online' });
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('minimum version (EVM-009 AC3)', () => {
  const required: StartupState = { kind: 'updateRequired', currentVersion: '0.1.0', requiredVersion: '0.2.0' };

  it('EVM-009 AC3: when the server requires a newer version the app shows the update screen with both versions', async () => {
    await start(required);
    expect(screen.getByRole('header', { name: pl.update.title })).toBeOnTheScreen();
    expect(screen.getByText(pl.update.body)).toBeOnTheScreen();
    expect(screen.getByText(pl.update.contact)).toBeOnTheScreen();
    expect(screen.getByText('Twoja wersja: 0.1.0 · Wymagana: 0.2.0')).toBeOnTheScreen();
  });

  it('EVM-009 AC3: the update screen is blocking — no bottom navigation, no sync capsule and no work-order content', async () => {
    await start(required);
    expect(screen.queryByLabelText(pl.shell.nav.label)).toBeNull();
    expect(screen.queryByTestId('sync-indicator')).toBeNull();
    expect(screen.queryByText(pl.shell.orders.emptyTitle)).toBeNull();
    expect(screen.queryByText(pl.shell.orders.title)).toBeNull();
  });

  it('EVM-009 AC3: the update screen offers no link or button that opens an address (sideload phishing, SR-MOB-07)', async () => {
    await start(required);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('EVM-009 AC3: on arrival the screen reader focus moves to the title', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await start(required);
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('EVM-009 AC3: a version that the server confirms replaces the shell, but offline the same app keeps working', async () => {
    await start({ kind: 'offline' });
    expect(screen.queryByText(pl.update.title)).toBeNull();
    expect(screen.getByText(pl.shell.orders.emptyTitle)).toBeOnTheScreen();
  });
});
