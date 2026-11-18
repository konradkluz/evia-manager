// The files in "Kolejka" (EVM-130 AC4, AC6): states, "Ponów", "Wymaga uwagi", the Banner of the notifications, the consent sheet, the target of
// a notification behind the lock of the app, the hidden-data mode. Texts exactly as AC6 and the mock-up 09 give them.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { App } from '../../src/App';
import { formatDateTime } from '../../src/i18n/format';
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
  workOrderId: '10000000-0000-4000-8000-000000000001',
  status: 'waiting',
  percent: null,
  sizeBytes: 1000,
  actions: [],
  code: null,
  updatedAt: AT,
  category: null,
  mediaType: 'photo',
  capturedAt: AT,
  ...patch,
});
const snap = (files: MediaFileView[], notifications: 'granted' | 'denied' = 'granted', confirmed = 0): MediaUploadsSnapshot => ({
  files,
  notifications,
  confirmed,
});

async function openQueue(rig: PortsRig): Promise<void> {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
  await settle();
}

describe('states of the files (EVM-130 AC4)', () => {
  it('EVM-130 AC4: oczekuje, wysyłanie z procentem, błąd z „Ponów” and „Wymaga uwagi” — each with its text, section and accessible name; EVM-111 AC5: no "Wysłano", no section of sent files', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([
        file(1, { status: 'waiting' }),
        file(2, { status: 'uploading', percent: 40 }),
        file(3, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }),
        file(4, { status: 'attention', code: 'id_conflict', actions: ['retry'] }),
        file(5, { status: 'attention', code: 'quarantined', actions: [] }),
      ]),
    );
    await openQueue(rig);
    expect(screen.queryByTestId('queue-empty')).toBeNull();
    expect(screen.getByTestId('files-summary')).toHaveTextContent('5 do wysłania', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent(pl.upload.states.waiting, { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent('Wysyła się 40%', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveAccessibilityValue({});
    expect(screen.getByTestId(`file-progress-${ID(2)}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`file-row-${ID(3)}`)).toHaveTextContent('Nie wysłano — plik uszkodzony w transmisji', { exact: false });
    // EVM-111 AC5: the entry of a confirmed file is removed from the phone, so there is no "Wysłano" and no section of sent files
    expect(screen.queryByText('Wysłano')).toBeNull();
    expect(screen.queryByText('Wysłane pliki')).toBeNull();
    expect(screen.queryByTestId('files-sent')).toBeNull();
    // the spoken name of a row: the category, the type, the time of the capture and the state
    expect(screen.getByLabelText(`Bez kategorii, Zdjęcie, ${formatDateTime(AT)}, Oczekuje`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Bez kategorii, Zdjęcie, ${formatDateTime(AT)}, Wysyła się 40%`)).toBeOnTheScreen();
    // "Wymaga uwagi": a card with a plain reason; a quarantine has no "Ponów"
    expect(screen.getByTestId(`file-attention-${ID(4)}`)).toHaveTextContent(pl.upload.reasons.id_conflict, { exact: false });
    expect(screen.getByTestId(`file-attention-${ID(5)}`)).toHaveTextContent(pl.upload.reasons.quarantined, { exact: false });
    // "Ponów" stays where EVM-130 had it: the failed file (3) and the file of "Wymaga uwagi" that can be retried (4); the quarantine (5) has none
    expect(screen.getAllByRole('button', { name: pl.upload.retryA11y })).toHaveLength(2);
    expect(screen.getByTestId(`file-retry-${ID(3)}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`file-attention-${ID(4)}-retry`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`file-attention-${ID(5)}-retry`)).toBeNull();
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
    await fireEvent.press(screen.getByRole('button', { name: pl.upload.retryA11y }));
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

  it('EVM-130 AC4, EVM-111 AC2: the last file leaving because the server CONFIRMED it is announced once ("Wszystko wysłane."); the same list emptying after "Usuń z telefonu" is not', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const rig = stubPorts();
    rig.media.set(snap([file(1, { status: 'uploading', percent: 90 })]));
    await openQueue(rig);
    announce.mockClear();
    await act(() => {
      rig.media.set(snap([], 'granted', 1));
    });
    await settle();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Wszystko wysłane.');
    announce.mockClear();
    await act(() => {
      rig.media.set(snap([file(2, { status: 'attention', code: 'quarantined', actions: ['discard'] })], 'granted', 1));
    });
    await act(() => {
      rig.media.set(snap([], 'granted', 1));
    });
    await settle();
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it('EVM-130 AC4, AC5: in the hidden-data mode the files are listed the same — a type and a state, no order, no name (SR-MOB-05)', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    rig.media.set(snap([file(1, { status: 'uploading', percent: 10 })]));
    await openQueue(rig);
    expect(screen.getByTestId('queue-list-hidden')).toBeOnTheScreen();
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent('Wysyła się 10%', { exact: false });
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
    rig.media.set(snap([], 'denied'));
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

describe('the rows of the files and "Usuń z telefonu" (EVM-108 AC6)', () => {
  const DEFECT = { category: 'defect' as const, capturedAt: AT };

  it('EVM-108 AC6: every file is a row of the shared component - the category, the time of the capture and the type - with exactly one of the four labels (EVM-111 AC5: "Wysłano" is not one of them any more)', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([
        file(1, { status: 'waiting', ...DEFECT }),
        file(2, { status: 'uploading', percent: 45, category: 'measurement', capturedAt: AT + 60_000 }),
        file(3, { status: 'error', code: 'checksum_mismatch', actions: ['retry'], category: 'other' }),
        file(4, { status: 'attention', code: 'quarantined', actions: ['discard'], category: 'site_survey' }),
      ]),
    );
    await openQueue(rig);
    const labels = [
      [1, 'Usterka / problem', 'Oczekuje'],
      [2, 'Pomiary', 'Wysyła się 45%'],
      [3, 'Inne', 'Nie wysłano — plik uszkodzony w transmisji'],
      [4, 'Oględziny', 'Wymaga uwagi'],
    ] as const;
    for (const [n, category, label] of labels) {
      const prefix = n === 4 ? 'file-attention' : 'file-row';
      const row = screen.getByTestId(`${prefix}-${ID(n)}`);
      expect(row).toHaveTextContent(category, { exact: false });
      expect(row).toHaveTextContent('Zdjęcie', { exact: false });
      expect(row).toHaveTextContent(label, { exact: false });
      // the same component: the same structure under every row (the group that is spoken)
      expect(screen.getByTestId(`${prefix}-${ID(n)}-info`)).toBeOnTheScreen();
    }
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent(formatDateTime(AT), { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent(formatDateTime(AT + 60_000), { exact: false });
    expect(screen.getByLabelText(`Usterka / problem, Zdjęcie, ${formatDateTime(AT)}, Oczekuje`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Pomiary, Zdjęcie, ${formatDateTime(AT + 60_000)}, Wysyła się 45%`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`Inne, Zdjęcie, ${formatDateTime(AT)}, Nie wysłano — plik uszkodzony w transmisji`)).toBeOnTheScreen();
    expect(screen.queryByText('Wysłano')).toBeNull();
    expect(screen.getByLabelText(`Oględziny, Zdjęcie, ${formatDateTime(AT)}, Wymaga uwagi`)).toBeOnTheScreen();
  });

  it('EVM-108 AC6: a file without a category (or with one from a newer version) says so in words; a video is a "Film"', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(1, { category: null }), file(2, { category: 'unknown', mediaType: 'video' })]));
    await openQueue(rig);
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent('Bez kategorii', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent('Film', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent('Bez kategorii', { exact: false });
  });

  it('EVM-108 AC6: the header counts every file of the queue - waiting, sending and the ones that need attention (EVM-111 AC5: a confirmed file has no entry, so none is "sent")', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([file(1), file(2, { status: 'uploading', percent: 3 }), file(3, { status: 'attention', code: 'unknown', actions: ['retry'] })]),
    );
    await openQueue(rig);
    expect(screen.getByTestId('files-summary')).toHaveTextContent('3 do wysłania', { exact: true });
    expect(screen.getByRole('header', { name: '3 do wysłania' })).toBeOnTheScreen();
    await act(() => {
      rig.media.set(snap([file(2, { status: 'uploading', percent: 3 })], 'granted', 2));
    });
    await settle();
    expect(screen.getByTestId('files-summary')).toHaveTextContent('1 do wysłania', { exact: true });
    await act(() => {
      rig.media.set(snap([], 'granted', 3));
    });
    await settle();
    expect(screen.queryByTestId('files-summary')).toBeNull();
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
  });

  it('EVM-108 AC6: no files = the existing empty message of the Queue (no counter, no list of files)', async () => {
    const rig = stubPorts();
    await openQueue(rig);
    expect(screen.getByTestId('queue-empty')).toBeOnTheScreen();
    expect(screen.getByText(pl.shell.queue.emptyTitle)).toBeOnTheScreen();
    expect(screen.queryByTestId('files-summary')).toBeNull();
  });

  it('EVM-108 AC6: "Usuń z telefonu" only on the files of "Wymaga uwagi" that offer it; the failed file and the one with "Ponów" only have none', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([
        file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] }),
        file(2, { status: 'attention', code: 'id_conflict', actions: ['retry', 'discard'] }),
        file(3, { status: 'attention', code: 'unknown', actions: ['retry'] }),
        file(4, { status: 'error', code: 'checksum_mismatch', actions: ['retry'] }),
        file(5, { status: 'waiting' }),
      ]),
    );
    await openQueue(rig);
    expect(screen.getAllByRole('button', { name: pl.upload.discardA11y })).toHaveLength(2);
    expect(screen.getByTestId(`file-attention-${ID(1)}-discard`)).toHaveTextContent('Usuń z telefonu');
    expect(screen.getByTestId(`file-attention-${ID(2)}-discard`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`file-attention-${ID(3)}-discard`)).toBeNull();
    expect(screen.queryByTestId(`file-row-${ID(4)}-discard`)).toBeNull();
    // "Ponów" is untouched by it: still on the files that had it (EVM-130)
    expect(screen.getByTestId(`file-attention-${ID(2)}-retry`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`file-attention-${ID(1)}-retry`)).toBeNull();
  });

  it('EVM-108 AC6: "Usuń z telefonu" asks first; "Anuluj" changes nothing, the confirmation removes the file through the module', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] })]));
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId(`file-attention-${ID(1)}-discard`));
    expect(screen.getByTestId('file-discard-dialog')).toBeOnTheScreen();
    expect(screen.getByText(pl.upload.discardBody)).toBeOnTheScreen();
    expect(pl.upload.discardBody).toBe('Usuniemy to zdjęcie z telefonu — nie trafi do biura. Tego nie da się cofnąć.');
    expect(rig.media.calls).not.toContain(`discard:${ID(1)}`);
    await fireEvent.press(screen.getByTestId('file-discard-cancel'));
    expect(screen.queryByTestId('file-discard-dialog')).toBeNull();
    expect(rig.media.calls.filter((call) => call.startsWith('discard:'))).toEqual([]);
    expect(screen.getByTestId(`file-attention-${ID(1)}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`file-attention-${ID(1)}-discard`));
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    expect(rig.media.calls.filter((call) => call.startsWith('discard:'))).toEqual([`discard:${ID(1)}`]);
    expect(screen.queryByTestId('file-discard-dialog')).toBeNull();
    expect(screen.queryByTestId('queue-notice')).toBeNull();
  });

  it('EVM-108 AC6: a refusal (the module could not remove the file, or it throws) says so and the row stays', async () => {
    const rig = stubPorts();
    rig.media.set(snap([file(1, { status: 'attention', code: 'quarantined', actions: ['discard'] })]));
    await openQueue(rig);
    rig.media.discardResult = false;
    await fireEvent.press(screen.getByTestId(`file-attention-${ID(1)}-discard`));
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(pl.attention.failed, { exact: false });
    expect(screen.getByTestId(`file-attention-${ID(1)}`)).toBeOnTheScreen();
    rig.media.discard = () => Promise.reject(new Error('synthetic'));
    await fireEvent.press(screen.getByTestId(`file-attention-${ID(1)}-discard`));
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    expect(screen.getByTestId('queue-notice')).toHaveTextContent(pl.attention.failed, { exact: false });
  });

  it('EVM-108 AC6: the rows show no customer and no address, and in the hidden-data mode no number of the order either; "Usuń z telefonu" works there too', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    rig.media.set(
      snap([
        file(1, { status: 'attention', code: 'quarantined', actions: ['discard'], ...DEFECT }),
        file(2, { status: 'waiting', ...DEFECT }),
      ]),
    );
    await openQueue(rig);
    expect(screen.getByTestId('queue-list-hidden')).toBeOnTheScreen();
    const tree = JSON.stringify(screen.toJSON());
    for (const secret of ['ZL-', 'Jan Łódzki', 'ul. ', '10000000-0000-4000']) expect(tree).not.toContain(secret);
    await fireEvent.press(screen.getByTestId(`file-attention-${ID(1)}-discard`));
    await fireEvent.press(screen.getByTestId('file-discard-confirm'));
    await settle();
    expect(rig.media.calls).toContain(`discard:${ID(1)}`);
  });
});
