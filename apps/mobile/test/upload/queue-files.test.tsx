// The files in "Kolejka" (EVM-130 AC4, AC6): states, "Ponów", "Wymaga uwagi", the Banner of the notifications, the consent sheet, the target of
// a notification behind the lock of the app, the hidden-data mode. Texts exactly as AC6 and the mock-up 09 give them.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { App } from '../../src/App';
import { pl } from '../../src/i18n/pl';
import { NotificationConsentSheet } from '../../src/screens/NotificationConsentSheet';
import type { StartupChecker } from '../../src/startup';
import type { MediaFileView, MediaUploadsSnapshot } from '../../src/upload/types';
import { stubOwner, stubPorts, type PortsRig } from '../session-helpers';

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
const AT = Date.UTC(2026, 10, 15, 8, 12);
const ID = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const file = (n: number, patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId: ID(n),
  status: 'waiting',
  percent: null,
  sizeBytes: 1000,
  actions: [],
  code: null,
  updatedAt: AT,
  ...patch,
});
const snap = (files: MediaFileView[], notifications: 'granted' | 'denied' = 'granted'): MediaUploadsSnapshot => ({ files, notifications });

async function openQueue(rig: PortsRig): Promise<void> {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
  await settle();
}

describe('states of the files (EVM-130 AC4)', () => {
  it('EVM-130 AC4: oczekuje, wysyłanie z procentem, wysłano, błąd z „Ponów” and „Wymaga uwagi” — each with its text, section and accessible name', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([
        file(1, { status: 'waiting' }),
        file(2, { status: 'uploading', percent: 40 }),
        file(3, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }),
        file(4, { status: 'attention', code: 'id_conflict', actions: ['retry'] }),
        file(5, { status: 'attention', code: 'quarantined', actions: [] }),
        file(6, { status: 'sent' }),
      ]),
    );
    await openQueue(rig);
    expect(screen.queryByTestId('queue-empty')).toBeNull();
    expect(screen.getByTestId('files-summary')).toHaveTextContent('Wysłano 1 z 6 · 5 w kolejce', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent(pl.upload.states.waiting, { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent('Wysyłanie 40%', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveAccessibilityValue({});
    expect(screen.getByTestId(`file-progress-${ID(2)}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`file-row-${ID(3)}`)).toHaveTextContent('Nie wysłano — plik uszkodzony w transmisji', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(6)}`)).toHaveTextContent('Wysłano', { exact: false });
    expect(screen.getByLabelText('Plik, Oczekuje')).toBeOnTheScreen();
    expect(screen.getByLabelText('Plik, Wysyłanie 40%')).toBeOnTheScreen();
    // "Wymaga uwagi": a card with a plain reason; a quarantine has no "Ponów"
    expect(screen.getByTestId(`file-attention-${ID(4)}`)).toHaveTextContent(pl.upload.reasons.id_conflict, { exact: false });
    expect(screen.getByTestId(`file-attention-${ID(5)}`)).toHaveTextContent(pl.upload.reasons.quarantined, { exact: false });
    expect(screen.getAllByRole('button', { name: pl.upload.retry })).toHaveLength(1);
    expect(screen.getAllByLabelText(pl.upload.retryA11y)).toHaveLength(1);
    expect(screen.getByTestId(`file-retry-${ID(3)}`)).toBeOnTheScreen();
  });

  it('EVM-130 AC4: "Ponów" hands the file to the module; a refusal says so and the list stays', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(3, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] })]));
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId(`file-retry-${ID(3)}`));
    await settle();
    expect(rig.media.calls).toContain(`retry:${ID(3)}`);
    expect(screen.queryByTestId('queue-notice')).toBeNull();
    rig.media.retryResult = false;
    await fireEvent.press(screen.getByTestId(`file-retry-${ID(3)}`));
    await settle();
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(pl.upload.retryFailed, { exact: false });
    rig.media.retry = () => Promise.reject(new Error('synthetic'));
    await fireEvent.press(screen.getByTestId(`file-retry-${ID(3)}`));
    await settle();
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(pl.upload.retryFailed, { exact: false });
  });

  it('EVM-130 AC4: "Ponów" on a card of "Wymaga uwagi" works the same', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(4, { status: 'attention', code: 'unknown', actions: ['retry'] })]));
    await openQueue(rig);
    expect(screen.getByTestId(`file-attention-${ID(4)}`)).toHaveTextContent(pl.upload.reasons.unknown, { exact: false });
    await fireEvent.press(screen.getByRole('button', { name: pl.upload.retry }));
    await settle();
    expect(rig.media.calls).toContain(`retry:${ID(4)}`);
  });

  it('EVM-130 AC4: no files — the empty state and nothing of the files; one file is no empty state', async () => {
    const rig = stubPorts();
    await openQueue(rig);
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-files')).toBeNull();
    await act(() => {
      rig.media.set(snap([file(1)]));
    });
    await settle();
    expect(screen.queryByTestId('queue-empty')).toBeNull();
    expect(screen.getByTestId('queue-files')).toBeOnTheScreen();
  });

  it('EVM-130 AC4: the last unsent file going away is announced once ("Wszystko wysłane.")', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const rig = stubPorts();
    rig.media.set(snap([file(1, { status: 'uploading', percent: 90 })]));
    await openQueue(rig);
    announce.mockClear();
    await act(() => {
      rig.media.set(snap([file(1, { status: 'sent' })]));
    });
    await settle();
    expect(announce).toHaveBeenCalledWith('Wszystko wysłane.');
    announce.mockRestore();
  });

  it('EVM-130 AC4, AC5: in the hidden-data mode the files are listed the same — a type and a state, no order, no name (SR-MOB-05)', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    rig.media.set(snap([file(1, { status: 'uploading', percent: 10 })]));
    await openQueue(rig);
    expect(screen.getByTestId('queue-list-hidden')).toBeOnTheScreen();
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent('Wysyłanie 10%', { exact: false });
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toContain('ZL-');
    expect(text).not.toContain('10000000-0000-4000');
  });
});

describe('the Banner of the notifications (EVM-130 AC6)', () => {
  it('EVM-130 AC6: without consent and with unsent files the Banner says it word for word; its action asks the system, and after a refusal opens the settings', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(1)], 'denied'));
    await openQueue(rig);
    expect(screen.getByTestId('notifications-banner')).toHaveTextContent(
      'Powiadomienia wyłączone — nie zobaczysz, że wysyłanie się zatrzymało.',
      { exact: false },
    );
    expect(screen.getByRole('button', { name: 'Włącz powiadomienia' })).toBeOnTheScreen();
    rig.media.consent = 'denied';
    await fireEvent.press(screen.getByTestId('notifications-enable'));
    await settle();
    expect(rig.media.calls).toEqual(expect.arrayContaining(['requestNotifications', 'openNotificationSettings']));
    rig.media.calls.length = 0;
    rig.media.consent = 'granted';
    await fireEvent.press(screen.getByTestId('notifications-enable'));
    await settle();
    expect(rig.media.calls).toEqual(['requestNotifications']);
  });

  it('EVM-130 AC6: with consent, with nothing unsent, or without files there is no Banner (it goes away after everything was sent or the notifications were turned on)', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(1, { status: 'sent' })], 'denied'));
    await openQueue(rig);
    expect(screen.queryByTestId('notifications-banner')).toBeNull();
    await act(() => {
      rig.media.set(snap([file(1)], 'granted'));
    });
    await settle();
    expect(screen.queryByTestId('notifications-banner')).toBeNull();
    await act(() => {
      rig.media.set(snap([file(1)], 'denied'));
    });
    await settle();
    expect(screen.getByTestId('notifications-banner')).toBeOnTheScreen();
  });
});

describe('the consent sheet (EVM-130 AC6, mock-up 09)', () => {
  it('EVM-130 AC6: "Powiadomienia o wysyłaniu" — the texts of the mock-up, two actions; "Nie teraz" and the system back close it', async () => {
    const calls: string[] = [];
    await render(<NotificationConsentSheet onAllow={() => calls.push('allow')} onLater={() => calls.push('later')} />);
    expect(screen.getByText('Powiadomienia o wysyłaniu')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Pokażemy postęp wysyłania i damy znać, gdy wysyłanie się zatrzyma i trzeba otworzyć aplikację. Bez nazwisk, adresów i numerów zleceń.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Włącz powiadomienia' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Nie teraz' }));
    expect(calls).toEqual(['allow', 'later']);
  });
});

describe('the target of a notification passes through the lock of the app (EVM-130 AC6; security 7)', () => {
  it('EVM-130 AC6: a touch of the notification on a locked app shows the lock first (the content is out of reach); after the unlock the Queue is open', async () => {
    const rig = stubPorts();
    rig.device.facts.auth = 'cancelled';
    rig.media.launchTarget = 'queue';
    rig.media.set(snap([file(1)]));
    await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
    expect(screen.getByTestId('lock-overlay')).toBeOnTheScreen();
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('pointerEvents', 'none');
    expect(screen.getByTestId('lock-content', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
    expect(rig.media.calls).toContain('consumeLaunchTarget');
    rig.device.facts.auth = 'success';
    await fireEvent.press(screen.getByTestId('lock-unlock'));
    await settle();
    expect(screen.queryByTestId('lock-overlay')).toBeNull();
    expect(screen.getByTestId('queue-files')).toBeOnTheScreen();
  });

  it('EVM-130 AC6: the target is read once; no target keeps the screen; a return to the foreground reads it again', async () => {
    const rig = stubPorts(stubOwner());
    await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
    expect(screen.queryByTestId('queue-files')).toBeNull();
    expect(screen.getByRole('header', { name: pl.shell.orders.title })).toBeOnTheScreen();
    rig.media.set(snap([file(1)]));
    rig.media.launchTarget = 'queue';
    await act(() => {
      rig.device.appState.emit('background');
      rig.device.appState.emit('active');
    });
    await settle();
    expect(screen.getByTestId('queue-files')).toBeOnTheScreen();
    expect(rig.media.launchTarget).toBeNull();
  });
});
