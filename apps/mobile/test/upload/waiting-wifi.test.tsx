// The films that wait for Wi-Fi and the setting "Filmy tylko przez Wi-Fi" on the screens (EVM-110 AC4, AC5, AC6): the row, the banner, the link, the switch.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../../src/App';
import { formatDateTime } from '../../src/i18n/format';
import { pl } from '../../src/i18n/pl';
import type { StartupChecker } from '../../src/startup';
import type { MediaFileView, MediaUploadsSnapshot } from '../../src/upload/types';
import { stubPorts, type PortsRig } from '../session-helpers';

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
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12, 0);
const ID = (n: number): string => `0194c2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const film = (n: number, patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId: ID(n),
  status: 'waiting_wifi',
  percent: null,
  sizeBytes: 78 * 1024 * 1024,
  actions: [],
  code: null,
  updatedAt: NOW,
  category: 'defect',
  mediaType: 'video',
  capturedAt: NOW - 60_000,
  durationMs: 133_000,
  ...patch,
});
const snap = (files: MediaFileView[]): MediaUploadsSnapshot => ({ files, notifications: 'granted' });

async function open(rig: PortsRig, checker: StartupChecker = online, tab: 'queue' | 'more' = 'queue'): Promise<void> {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await render(<App session={rig.session} checker={checker} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByTestId(tab === 'queue' ? 'nav-queue' : 'nav-more'));
  await settle();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a film that waits for Wi-Fi in the Queue (EVM-110 AC4)', () => {
  it('EVM-110 AC4: the row says "Czeka na Wi-Fi" with the icon, in its own section, and is not "Wymaga uwagi" - the pictures keep their own states', async () => {
    const rig = stubPorts();
    rig.media.set(snap([film(1), film(2, { status: 'waiting', mediaType: 'photo', durationMs: null, sizeBytes: 1000 })]));
    await open(rig);
    expect(screen.getByTestId('files-waiting-wifi')).toBeOnTheScreen();
    expect(screen.getByText('Czeka na Wi-Fi (1)')).toBeOnTheScreen();
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent('Czeka na Wi-Fi', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(2)}`)).toHaveTextContent(pl.upload.states.waiting, { exact: false });
    expect(screen.queryByTestId('files-attention')).toBeNull();
    expect(screen.queryByTestId('notifications-banner')).toBeNull();
    // it still counts as a file to send (it is on its way, not lost), and there is no action on it
    expect(screen.getByTestId('files-summary')).toHaveTextContent('2 do wysłania', { exact: false });
    expect(screen.queryByTestId(`file-retry-${ID(1)}`)).toBeNull();
    expect(
      screen.getByLabelText(`Usterka / problem, Film · 2:13 · 78 MB, ${formatDateTime(NOW - 60_000)}, Czeka na Wi-Fi`),
    ).toBeOnTheScreen();
  });

  it.each([
    [0, 'Czeka na Wi-Fi'],
    [1, 'Czeka na Wi-Fi od 1 dnia'],
    [2, 'Czeka na Wi-Fi od 2 dni'],
    [5, 'Czeka na Wi-Fi od 5 dni'],
    [8, 'Czeka na Wi-Fi od 8 dni'],
    [22, 'Czeka na Wi-Fi od 22 dni'],
  ])(
    'EVM-110 AC4 AC5: a film that waited %i days reads "%s" (and goes on waiting after 7 days - no "Wymaga uwagi")',
    async (days, label) => {
      const rig = stubPorts();
      rig.media.set(snap([film(1, { capturedAt: NOW - days * DAY - 5_000 })]));
      await open(rig);
      expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent(label, { exact: false });
      expect(screen.queryByTestId('files-attention')).toBeNull();
    },
  );

  it('EVM-110 AC4: with no network at all the film waits for "połączenie", not for Wi-Fi - and there is no banner of Wi-Fi', async () => {
    const rig = stubPorts();
    rig.media.set(snap([film(1)]));
    await open(rig, offline);
    expect(screen.getByTestId(`file-row-${ID(1)}`)).toHaveTextContent('Czeka na połączenie', { exact: false });
    expect(screen.getByTestId(`file-row-${ID(1)}`)).not.toHaveTextContent('Wi-Fi', { exact: false });
    expect(screen.queryByTestId('waiting-wifi-banner')).toBeNull();
  });

  it.each([
    [1, '1 film czeka na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
    [2, '2 filmy czekają na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
    [4, '4 filmy czekają na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
    [5, '5 filmów czeka na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
    [12, '12 filmów czeka na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
    [22, '22 filmy czekają na Wi-Fi. Zdjęcia i wpisy wysyłamy normalnie.'],
  ])('EVM-110 AC4: %i films give the one banner "%s" with the link "Zmień ustawienie"', async (count, text) => {
    const rig = stubPorts();
    rig.media.set(snap(Array.from({ length: count }, (_unused, index) => film(index + 1))));
    await open(rig);
    expect(screen.getByTestId('waiting-wifi-banner')).toHaveTextContent(text, { exact: false });
    expect(screen.getAllByTestId('waiting-wifi-banner')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Zmień ustawienie' })).toBeOnTheScreen();
  });

  it('EVM-110 AC4: there is no banner without a film that waits (pictures only, a film that sends, a film that was sent)', async () => {
    const rig = stubPorts();
    rig.media.set(
      snap([
        film(1, { status: 'waiting', mediaType: 'photo', durationMs: null }),
        film(2, { status: 'uploading', percent: 30 }),
        film(3, { status: 'sent' }),
      ]),
    );
    await open(rig);
    expect(screen.queryByTestId('waiting-wifi-banner')).toBeNull();
    expect(screen.queryByTestId('files-waiting-wifi')).toBeNull();
  });

  it('EVM-110 AC4: "Zmień ustawienie" leads to "Więcej" with the setting "Filmy tylko przez Wi-Fi"', async () => {
    const rig = stubPorts();
    rig.media.set(snap([film(1)]));
    await open(rig);
    await fireEvent.press(screen.getByTestId('waiting-wifi-change'));
    await settle();
    expect(screen.getByTestId('more-wifi-switch')).toBeOnTheScreen();
    expect(screen.getByText('Wysyłanie')).toBeOnTheScreen();
    expect(screen.queryByTestId('queue-files')).toBeNull();
  });

  it('EVM-110 AC4 AC6: in the hidden-data mode the row of a film waiting for Wi-Fi has no number of the order, and the banner is the same', async () => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    rig.media.set(snap([film(1), film(2)]));
    await open(rig);
    expect(screen.getByTestId('queue-list-hidden')).toBeOnTheScreen();
    expect(screen.getByTestId('waiting-wifi-banner')).toHaveTextContent('2 filmy czekają na Wi-Fi.', { exact: false });
    const tree = JSON.stringify(screen.toJSON());
    for (const secret of ['ZL-', 'Jan Łódzki', 'ul. ', '10000000-0000-4000']) expect(tree).not.toContain(secret);
  });
});

describe('the setting "Filmy tylko przez Wi-Fi" in "Więcej" (EVM-110 AC4)', () => {
  const sw = () => screen.getByTestId('more-wifi-switch');

  it('EVM-110 AC4: the switch is ON by default, a switch role with the state and the explanation of the ON state, and the target is at least 48 dp', async () => {
    const rig = stubPorts();
    await open(rig, online, 'more');
    expect(screen.getByRole('header', { name: 'Wysyłanie' })).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).toBeChecked();
    expect(screen.getByTestId('more-wifi-description')).toHaveTextContent(pl.more.upload.wifiOn, { exact: false });
    expect(sw()).toHaveProp('accessibilityHint', pl.more.upload.wifiOn);
    expect(sw()).toHaveStyle({ minHeight: 48 });
    expect(pl.more.upload.wifiOn).toContain('Hotspot z telefonu to sieć z opłatami: film poczeka.');
    expect(pl.more.upload.wifiOn).toContain('Zdjęcia i wpisy wysyłamy normalnie, także przez sieć komórkową.');
  });

  it('EVM-110 AC4: turning it off is one tap with NO dialog - the module stores it, the explanation changes, and turning it on again works the same', async () => {
    const rig = stubPorts();
    await open(rig, online, 'more');
    await fireEvent.press(sw());
    await settle();
    expect(rig.media.calls).toContain('setVideoWifiOnly:false');
    expect(screen.queryByTestId('alert-dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).not.toBeChecked();
    expect(screen.getByTestId('more-wifi-description')).toHaveTextContent(pl.more.upload.wifiOff, { exact: false });
    expect(pl.more.upload.wifiOff).toContain('zużyją pakiet danych');
    await fireEvent.press(sw());
    await settle();
    expect(rig.media.calls.filter((call) => call.startsWith('setVideoWifiOnly'))).toEqual([
      'setVideoWifiOnly:false',
      'setVideoWifiOnly:true',
    ]);
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).toBeChecked();
  });

  it('EVM-110 AC4: the switch is blocked until the value is stored, and shows what the module holds - a value that was not stored does not change it', async () => {
    const rig = stubPorts();
    let finish: () => void = () => undefined;
    rig.media.setVideoWifiOnly = (value) => {
      rig.media.calls.push(`setVideoWifiOnly:${String(value)}`);
      return new Promise((resolve) => {
        finish = () => {
          resolve(true);
        };
      });
    };
    await open(rig, online, 'more');
    await fireEvent.press(sw());
    expect(sw()).toBeDisabled();
    await fireEvent.press(sw());
    expect(rig.media.calls.filter((call) => call.startsWith('setVideoWifiOnly'))).toEqual(['setVideoWifiOnly:false']);
    rig.media.wifiOnly = false;
    await act(() => {
      finish();
    });
    await settle();
    expect(sw()).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).not.toBeChecked();
  });

  it('EVM-110 AC4: a refusal of the module (the value was not stored) leaves the switch as the module holds it', async () => {
    const rig = stubPorts();
    rig.media.wifiSaves = false;
    await open(rig, online, 'more');
    await fireEvent.press(sw());
    await settle();
    expect(rig.media.calls).toContain('setVideoWifiOnly:false');
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).toBeChecked();
    expect(sw()).toBeEnabled();
  });

  it('EVM-110 AC4: the setting is read from the module when the screen opens - a phone that had it off shows it off (it stays after the sign-out and the wipe)', async () => {
    const rig = stubPorts();
    rig.media.wifiOnly = false;
    await open(rig, online, 'more');
    expect(screen.getByRole('switch', { name: 'Filmy tylko przez Wi-Fi' })).not.toBeChecked();
    expect(screen.getByTestId('more-wifi-description')).toHaveTextContent(pl.more.upload.wifiOff, { exact: false });
  });
});
