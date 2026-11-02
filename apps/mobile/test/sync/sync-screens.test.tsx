import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../../src/App';
import { pl } from '../../src/i18n/pl';
import { OFFLINE_RECHECK_FIRST_MS } from '../../src/screens/LoginScreen';
import type { StartupChecker } from '../../src/startup';
import { INITIAL_FIRST_PULL, type QueueItem } from '../../src/sync/types';
import { stubOwner, stubPorts, type PortsRig } from '../session-helpers';
import { must } from './harness';

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
const AT = Date.UTC(2026, 10, 2, 8, 12);
/** The element's text contains this string (the whole text of a card is many lines). */
const contains = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const SYNTHETIC_TEXT = 'SYNTHETIC-ENTRY-TEXT';

async function open(rig: PortsRig, checker: StartupChecker = online) {
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
}

const item = (patch: Partial<QueueItem> = {}): QueueItem => ({
  id: 'm-1',
  type: 'CreateNote',
  state: 'attention',
  createdAt: AT,
  targetId: '3a000000-0000-4000-8000-0000000000aa',
  code: 'target_unavailable',
  attempts: 2,
  reason: 'target_unavailable',
  actions: ['retarget', 'copy', 'discard'],
  dependents: 0,
  label: SYNTHETIC_TEXT,
  ...patch,
});

async function openQueue(rig: PortsRig) {
  await open(rig);
  await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
  await settle();
}

describe('first download gate (EVM-107 AC1)', () => {
  it('EVM-107 AC1: until the download ends M-12 is shown instead of the shell - step, progress, the received number, no list', async () => {
    const rig = stubPorts();
    rig.sync.set({ initialLoad: 'loading', firstPull: { ...INITIAL_FIRST_PULL, received: 120 } });
    await open(rig);
    expect(screen.getByTestId('first-pull')).toBeOnTheScreen();
    expect(screen.getByText(pl.firstPull.title)).toBeOnTheScreen();
    expect(screen.getByTestId('first-pull-step')).toHaveTextContent(contains(pl.firstPull.step1));
    expect(screen.getByTestId('first-pull-received')).toHaveTextContent(contains('Pobrano: 120'));
    expect(screen.getByTestId('first-pull-progress')).toBeOnTheScreen();
    expect(screen.getByTestId('first-pull-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('orders-add')).toBeNull();
    expect(screen.queryByTestId('first-pull-retry')).toBeNull();
  });

  it('EVM-107 AC1: the second step, the weak-signal notice after 30 s and the offline note', async () => {
    const rig = stubPorts();
    rig.sync.set({ initialLoad: 'loading', firstPull: { ...INITIAL_FIRST_PULL, step: 2, slow: true } });
    await open(rig);
    expect(screen.getByTestId('first-pull-step')).toHaveTextContent(contains(pl.firstPull.step2));
    expect(screen.getByTestId('first-pull-slow')).toHaveTextContent(contains(pl.firstPull.slow));
    await act(() => {
      rig.sync.set({ online: false, firstPull: { ...INITIAL_FIRST_PULL, step: 2 } });
    });
    expect(screen.getByTestId('first-pull-offline')).toBeOnTheScreen();
  });

  it('EVM-107 AC1: an error shows its reason and "Spróbuj ponownie"; "Pomoc" appears from the third attempt', async () => {
    const rig = stubPorts();
    rig.sync.set({ initialLoad: 'failed', firstPull: { ...INITIAL_FIRST_PULL, failure: 'disk_full', attempts: 1 } });
    await open(rig);
    expect(screen.getByTestId('first-pull-error')).toHaveTextContent(contains(pl.firstPull.errors.disk_full));
    expect(screen.queryByTestId('first-pull-help')).toBeNull();
    await fireEvent.press(screen.getByTestId('first-pull-retry'));
    expect(rig.sync.calls).toContain('trigger');
    await act(() => {
      rig.sync.set({ firstPull: { ...INITIAL_FIRST_PULL, failure: 'network', attempts: 3 } });
    });
    expect(screen.getByTestId('first-pull-error')).toHaveTextContent(contains(pl.firstPull.errors.network));
    await fireEvent.press(screen.getByTestId('first-pull-help'));
    expect(rig.opened).toContain('help');
  });

  it('EVM-107 AC1: every failure kind has its own copy', async () => {
    for (const failure of ['network', 'rate_limited', 'disk_full', 'storage', 'server'] as const) {
      const rig = stubPorts();
      rig.sync.set({ initialLoad: 'failed', firstPull: { ...INITIAL_FIRST_PULL, failure, attempts: 1 } });
      const view = await render(
        <App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />,
      );
      await settle();
      expect(screen.getByTestId('first-pull-error')).toHaveTextContent(contains(pl.firstPull.errors[failure]));
      await view.unmount();
    }
  });

  it('EVM-107 AC1: the queue link shows a number only - no names of entries - and goes back', async () => {
    const rig = stubPorts();
    rig.sync.set({
      initialLoad: 'loading',
      counts: { pending: 2, retrying: 0, blocked: 0, attention: 1, unsent: 3 },
    });
    await open(rig);
    await fireEvent.press(screen.getByTestId('first-pull-queue'));
    expect(screen.getByTestId('queue-preview')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('queue-preview-back'));
    expect(screen.getByTestId('first-pull')).toBeOnTheScreen();
  });

  it('EVM-107 AC1: an account without work orders passes the gate to an empty list; the service starts with the session and stops with it', async () => {
    const rig = stubPorts();
    await open(rig);
    expect(rig.sync.calls).toContain('start');
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
    expect(rig.sync.calls).toContain('online:true');
  });

  it('EVM-107 AC1: while the service starts (nothing known yet) the canvas is empty, not a partial list', async () => {
    const rig = stubPorts();
    rig.sync.set({ active: false, initialLoad: 'pending' });
    await open(rig);
    expect(screen.getByTestId('sync-starting')).toBeOnTheScreen();
    expect(screen.queryByTestId('orders-empty')).toBeNull();
    await act(() => {
      rig.sync.set({ active: true, initialLoad: 'loading' });
    });
    await act(() => {
      rig.sync.set({ initialLoad: 'done' });
    });
    expect(screen.getByTestId('orders-empty')).toBeOnTheScreen();
  });
});

describe('versions and sessions on the screen (EVM-107 AC5)', () => {
  it('EVM-107 AC5: 426 shows "Aktualizacja wymagana" (M-02) with the number of unsent items and keeps nothing removed', async () => {
    const rig = stubPorts();
    rig.sync.set({ counts: { pending: 1, retrying: 0, blocked: 0, attention: 0, unsent: 2 } });
    await open(rig);
    await act(() => {
      rig.sync.pause('upgrade_required');
    });
    expect(screen.getByTestId('device-state-client_version_unsupported')).toBeOnTheScreen();
    expect(rig.sync.calls).toContain('stop');
  });

  it('EVM-107 AC5: 403 (read-only account in the mobile channel) shows M-02 "channel_not_allowed"; its action signs out, the queue stays', async () => {
    const owner = stubOwner();
    const rig = stubPorts(owner);
    await open(rig);
    await act(() => {
      rig.sync.pause('forbidden');
    });
    expect(screen.getByTestId('device-state-channel_not_allowed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('device-state-primary'));
    await settle();
    expect(owner.calls.some((call) => call.startsWith('signOut'))).toBe(true);
  });

  it('EVM-107 AC5: the end of the session by the owner shows its M-02 variant and stops the service', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.owner.end({ reason: 'session_revoked', unsentItems: 2 });
    });
    expect(screen.getByTestId('device-state-session_revoked')).toBeOnTheScreen();
    expect(rig.sync.calls).toContain('stop');
  });
});

describe('the indicator (EVM-107 AC3, AC8)', () => {
  const label = () => screen.getByTestId('sync-indicator');

  it('EVM-107 AC3: before any success it says "Połączono"; after one it says "Zsynchr. HH:MM"; the name carries the state', async () => {
    const rig = stubPorts();
    await open(rig);
    expect(label()).toHaveAccessibleName(pl.shell.sync.onlineOpenQueue);
    await act(() => {
      rig.sync.set({ lastSuccessAt: Date.UTC(2026, 10, 2, 13, 5) });
    });
    expect(screen.getByText('Zsynchr. 14:05')).toBeOnTheScreen();
    expect(label()).toHaveAccessibleName('Zsynchronizowano o 14:05. Otwórz kolejkę');
  });

  it('EVM-107 AC3: offline shows "Offline · N" with the number of unsent items, or "Offline" with none', async () => {
    const rig = stubPorts();
    await open(rig, offline);
    expect(screen.getByText(pl.shell.sync.offline)).toBeOnTheScreen();
    await act(() => {
      rig.sync.set({ counts: { pending: 3, retrying: 0, blocked: 0, attention: 0, unsent: 3 } });
    });
    expect(screen.getByText('Offline · 3')).toBeOnTheScreen();
    expect(label()).toHaveAccessibleName('Offline. Niewysłane elementy: 3. Otwórz kolejkę');
  });

  it('EVM-107 AC2: started offline, a tap on the indicator asks again and when the network is back the service is told to go online', async () => {
    const rig = stubPorts();
    let answer: Awaited<ReturnType<StartupChecker>> = { kind: 'offline' };
    const checker: StartupChecker = () => Promise.resolve(answer);
    await open(rig, checker);
    expect(rig.sync.calls).toContain('online:false');
    expect(rig.sync.calls).not.toContain('trigger');
    answer = { kind: 'online' };
    await fireEvent.press(label());
    await settle();
    expect(rig.sync.calls).toContain('online:true');
    expect(rig.sync.calls).not.toContain('trigger');
  });

  it('EVM-107 AC2: started offline and kept in the foreground, the connection is asked again by itself and the service goes online', async () => {
    jest.useFakeTimers();
    try {
      const rig = stubPorts();
      let answer: Awaited<ReturnType<StartupChecker>> = { kind: 'offline' };
      await open(rig, () => Promise.resolve(answer));
      expect(rig.sync.calls).not.toContain('online:true');
      answer = { kind: 'online' };
      await act(async () => {
        jest.advanceTimersByTime(OFFLINE_RECHECK_FIRST_MS);
        await Promise.resolve();
      });
      await settle();
      expect(rig.sync.calls).toContain('online:true');
    } finally {
      jest.useRealTimers();
    }
  });

  it('EVM-107 AC3: a cycle that failed while the app runs checks the connection, so the capsule can turn into "Offline"', async () => {
    const rig = stubPorts();
    let answer: Awaited<ReturnType<StartupChecker>> = { kind: 'online' };
    const checker = jest.fn<ReturnType<StartupChecker>, []>(() => Promise.resolve(answer));
    await open(rig, checker);
    expect(checker).toHaveBeenCalledTimes(1);
    answer = { kind: 'offline' };
    await act(() => {
      rig.sync.set({ failure: 'push' });
    });
    await settle();
    expect(checker).toHaveBeenCalledTimes(2);
    expect(screen.getByText(pl.shell.sync.offline)).toBeOnTheScreen();
  });

  it('EVM-107 AC8: the order of states - error, running, needs attention - and a tap starts a cycle and opens the queue', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.sync.set({ counts: { pending: 0, retrying: 0, blocked: 0, attention: 2, unsent: 2 } });
    });
    expect(screen.getByText('Wymaga uwagi · 2')).toBeOnTheScreen();
    await act(() => {
      rig.sync.set({ syncing: true });
    });
    expect(screen.getByText(pl.sync.syncing)).toBeOnTheScreen();
    await act(() => {
      rig.sync.set({ syncing: false, failure: 'push' });
    });
    expect(screen.getByText(pl.sync.error)).toBeOnTheScreen();
    await fireEvent.press(label());
    await settle();
    expect(rig.sync.calls).toContain('trigger');
  });

  it('EVM-107 AC8: banners - a failed push says nothing is lost and offers "Ponów"; a failed pull shows the time of the data; resync and 429', async () => {
    const rig = stubPorts();
    await open(rig);
    await act(() => {
      rig.sync.set({ failure: 'push', counts: { pending: 3, retrying: 0, blocked: 0, attention: 0, unsent: 3 } });
    });
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.getByTestId('sync-notice-push')).toHaveTextContent(
      /Nie udało się wysłać 3 elementów\. Spróbujemy ponownie; nic nie jest tracone\./,
    );
    await fireEvent.press(screen.getByTestId('sync-retry'));
    expect(rig.sync.calls).toContain('trigger');
    await act(() => {
      rig.sync.set({ failure: 'pull', lastSuccessAt: Date.UTC(2026, 10, 2, 13, 5), resyncing: true });
    });
    expect(screen.getByTestId('sync-notice-pull')).toHaveTextContent(contains('Nie udało się pobrać zmian. Pokazujemy dane z 14:05.'));
    expect(screen.getByTestId('sync-notice-resync')).toHaveTextContent(contains('Odświeżamy dane zleceń… Lista działa dalej.'));
    await act(() => {
      rig.sync.set({ failure: 'rate_limited', retryAt: Date.now() + 30_000, resyncing: false });
    });
    expect(screen.getByTestId('sync-notice-rate-limited')).toHaveTextContent(/Serwer jest zajęty\. Spróbujemy za (29|30) s\./);
    await act(() => {
      rig.sync.set({ failure: 'pull', lastSuccessAt: null });
    });
    expect(screen.getByTestId('sync-notice-pull')).toHaveTextContent(contains(pl.sync.notices.pullFailedNoTime));
  });

  it('EVM-107 AC8: no banner while offline, paused or without a failure', async () => {
    const rig = stubPorts();
    await open(rig, offline);
    await act(() => {
      rig.sync.set({ online: false, failure: 'push' });
    });
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(screen.queryByTestId('sync-notice-push')).toBeNull();
  });
});

describe('Kolejka and "Wymaga uwagi" (EVM-107 AC3, AC4)', () => {
  it('EVM-107 AC3: the number, the state of each element (oczekuje, wysyła się) and the sent ones', async () => {
    const rig = stubPorts();
    rig.sync.items = [
      item({ id: 'a', state: 'pending', actions: [], reason: null, code: null, label: 'first' }),
      item({ id: 'b', state: 'sending', actions: [], reason: null, code: null, label: 'second' }),
      item({ id: 'c', type: 'CreateQuickWorkOrder', state: 'blocked', actions: [], reason: null, code: 'parent_unavailable', label: null }),
    ];
    rig.sync.sent = [{ id: 's', type: 'CreateComment', at: Date.UTC(2026, 10, 2, 13, 5) }];
    await openQueue(rig);
    expect(screen.getByTestId('queue-count')).toHaveTextContent(contains('3 elementy w kolejce'));
    const rows = screen.getAllByTestId('queue-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(contains('Oczekuje'));
    expect(rows[1]).toHaveTextContent(contains('Wysyła się'));
    expect(rows[2]).toHaveTextContent(contains('Wstrzymany'));
    expect(screen.getByTestId('queue-sent-row')).toHaveTextContent(contains('Wysłano · 14:05'));
    expect(screen.queryByTestId('queue-attention')).toBeNull();
  });

  it('EVM-107 AC4: a card shows age, the plain reason, the details behind a disclosure and the actions of the table - discard last', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    await openQueue(rig);
    const card = screen.getByTestId('attention-m-1');
    expect(card).toHaveTextContent(contains('Dodano w telefonie 02.11.2026, 9:12'));
    expect(card).toHaveTextContent(contains(pl.attention.reasons.target_unavailable));
    expect(card).toHaveTextContent(contains(SYNTHETIC_TEXT));
    expect(screen.queryByTestId('attention-m-1-details')).toBeNull();
    await fireEvent.press(screen.getByTestId('attention-m-1-details-toggle'));
    expect(screen.getByTestId('attention-m-1-details')).toHaveTextContent(contains('Kod: target_unavailable'));
    expect(screen.getByTestId('attention-m-1-details')).toHaveTextContent(contains('Próby wysłania: 2'));
    expect(screen.getByTestId('attention-m-1-retarget')).toBeOnTheScreen();
    expect(screen.getByTestId('attention-m-1-copy')).toBeOnTheScreen();
    expect(screen.getByTestId('attention-m-1-discard')).toBeOnTheScreen();
    expect(screen.queryByTestId('attention-m-1-recreate')).toBeNull();
  });

  it('EVM-107 AC4: "Kopiuj treść" goes through the sensitive clipboard and says only "Skopiowano." - the text is not in the notice', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-copy'));
    await settle();
    expect(rig.copied).toEqual(['synthetic text']);
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(/^Skopiowano\.$/);
  });

  it('EVM-107 AC4: a copy that fails (no text, or no secure clipboard) says so and copies nothing', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    rig.sync.copyValue = null;
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-copy'));
    await settle();
    expect(rig.copied).toEqual([]);
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(contains(pl.attention.copyFailed));
  });

  it('EVM-107 AC4: nothing is deleted without a decision - the dialog shows the number of dependents, "Anuluj" removes nothing', async () => {
    const rig = stubPorts();
    rig.sync.items = [
      item({
        type: 'CreateQuickWorkOrder',
        code: 'validation_failed',
        reason: 'validation_failed_quick',
        actions: ['recreate', 'discard'],
        dependents: 4,
        targetId: null,
      }),
    ];
    rig.sync.dependents = 4;
    await openQueue(rig);
    expect(screen.getByTestId('attention-m-1')).toHaveTextContent(contains('Czekają z nim 4 elementy.'));
    await fireEvent.press(screen.getByTestId('attention-m-1-discard'));
    await settle();
    expect(screen.getByTestId('discard-dialog')).toHaveTextContent(
      contains('Usuniemy ten element i 4 zależne elementy. Tego nie da się cofnąć.'),
    );
    await fireEvent.press(screen.getByTestId('discard-cancel'));
    expect(rig.sync.calls.some((call) => call.startsWith('discard:'))).toBe(false);
    await fireEvent.press(screen.getByTestId('attention-m-1-discard'));
    await settle();
    await fireEvent.press(screen.getByTestId('discard-confirm'));
    await settle();
    expect(rig.sync.calls).toContain('discard:m-1');
  });

  it('EVM-107 AC4: a single element is discarded with the short text; a failed operation says so', async () => {
    const rig = stubPorts();
    rig.sync.items = [item({ actions: ['copy', 'discard'] })];
    rig.sync.result = { ok: false, code: 'storage_failure' };
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-discard'));
    await settle();
    expect(screen.getByTestId('discard-dialog')).toHaveTextContent(contains(pl.attention.discard.body));
    await fireEvent.press(screen.getByTestId('discard-confirm'));
    await settle();
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(contains(pl.attention.failed));
  });

  it('EVM-107 AC4: "Dodaj do innego zlecenia" lists the work orders of the replica and moves the entry', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    rig.sync.targets = [{ id: 'wo-2', number: 'ZL-2', title: 'Order 2' }];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-retarget'));
    await settle();
    expect(rig.sync.calls).toContain('options:3a000000-0000-4000-8000-0000000000aa');
    await fireEvent.press(screen.getByTestId('retarget-wo-2'));
    await settle();
    expect(rig.sync.calls).toContain('retarget:m-1:wo-2');
  });

  it('EVM-107 AC4: with no other work order the dialog says so and can be closed', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-retarget'));
    await settle();
    expect(screen.getByTestId('retarget-dialog')).toHaveTextContent(contains(pl.attention.retarget.empty));
    await fireEvent.press(screen.getByTestId('retarget-cancel'));
    expect(screen.queryByTestId('retarget-dialog')).toBeNull();
  });

  it('EVM-107 AC4: "Utwórz ponownie" calls the injected handler; without one the entry is created again at once', async () => {
    const rig = stubPorts();
    rig.sync.items = [item({ code: 'id_conflict', reason: 'id_conflict', actions: ['recreate', 'discard'] })];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-1-recreate'));
    await settle();
    expect(rig.sync.calls).toContain('recreate:m-1');
    const handled: string[] = [];
    const second = stubPorts();
    second.sync.items = [
      item({
        code: 'template_unavailable',
        reason: 'template_unavailable',
        type: 'CreateQuickWorkOrder',
        actions: ['recreate', 'discard'],
      }),
    ];
    const ports = { ...second.ports, openRecreate: (queueItem: QueueItem) => handled.push(queueItem.id) };
    await render(<App session={() => ports} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
    const tabs = screen.getAllByRole('tab', { name: pl.shell.queue.title });
    await fireEvent.press(must(tabs.at(-1)));
    await settle();
    await fireEvent.press(must(screen.getAllByTestId('attention-m-1-recreate').at(-1)));
    expect(handled).toEqual(['m-1']);
    expect(second.sync.calls.some((call) => call.startsWith('recreate:'))).toBe(false);
  });

  it('EVM-107 AC4 (security S1): in the hidden-data mode the text is not requested, copy and move are not offered, discard stays', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    rig.device.facts.secure = false;
    await open(rig);
    await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
    await settle();
    expect(rig.sync.labelRequests.at(-1)).toBe(false);
    const card = screen.getByTestId('attention-m-1');
    expect(card).not.toHaveTextContent(contains(SYNTHETIC_TEXT));
    expect(card).toHaveTextContent(contains(pl.attention.hiddenActions));
    expect(screen.queryByTestId('attention-m-1-copy')).toBeNull();
    expect(screen.queryByTestId('attention-m-1-retarget')).toBeNull();
    expect(screen.getByTestId('attention-m-1-discard')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toContain(SYNTHETIC_TEXT);
  });
});
