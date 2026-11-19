import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { App } from '../../src/App';
import { pl } from '../../src/i18n/pl';
import { type StartupChecker } from '../../src/startup';
import type { QueueItem } from '../../src/sync/types';
import type { MediaFileView } from '../../src/upload/types';
import { stubPorts, type PortsRig } from '../session-helpers';

// EVM-137 AC6, AC5 (security W5, W9, W10): "Wymaga uwagi" of a site survey and of what belongs to it - the reason in Polish without the address,
// only "Usuń z telefonu", the dialog with what goes with it, and one row with an action for every file. Synthetic data only.
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
const AT = Date.UTC(2026, 10, 16, 12, 0, 0);
const ADDRESS = /Fikcyjna|Piaseczno|05-500|600 000 011/;
const item = (patch: Partial<QueueItem> = {}): QueueItem => ({
  id: 'm-s',
  type: 'CreateSiteSurvey',
  state: 'attention',
  createdAt: AT,
  targetId: null,
  code: 'feature_disabled',
  attempts: 1,
  reason: 'feature_disabled',
  actions: ['discard'],
  dependents: 0,
  label: null,
  ...patch,
});
const file = (patch: Partial<MediaFileView> = {}): MediaFileView => ({
  assetId: '0194c2a0-0000-7000-8000-000000000f01',
  workOrderId: '10000000-0000-4000-8000-000000000001',
  sizeBytes: 1000,
  updatedAt: AT,
  code: 'survey_gone',
  category: 'site_survey',
  mediaType: 'photo',
  capturedAt: AT,
  durationMs: null,
  status: 'attention',
  percent: null,
  actions: ['discard'],
  ...patch,
});
const whole = (): string => {
  const seen = new WeakSet<object>();
  return JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return typeof value === 'function' ? undefined : value;
  });
};
async function openQueue(rig: PortsRig) {
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByRole('tab', { name: pl.shell.queue.title }));
  await settle();
}

describe('a rejected survey (EVM-137 AC6)', () => {
  const reasons: [string, string][] = [
    ['validation_failed_survey', 'Wizja lokalna nie została utworzona — sprawdź adres i numer telefonu.'],
    ['id_conflict_survey', 'Ta wizja nie mogła zostać zapisana — załóż ją ponownie.'],
    ['feature_disabled', 'Wizja lokalna nie została utworzona — funkcja jest wyłączona. Zapytaj administratora.'],
    [
      'quota_exceeded_survey',
      'Dziś założono zbyt wiele nowych lokalizacji z tego telefonu. Spróbuj ponownie jutro albo usuń wizję z telefonu.',
    ],
    ['site_survey_limit', 'Masz za dużo otwartych wizji — przypisz klienta, odrzuć lub poczekaj na wygaśnięcie.'],
    ['survey_unavailable', 'Wizja lokalna została usunięta — biuro mogło ją odrzucić albo minął jej termin.'],
  ];
  it.each(reasons)(
    'EVM-137 AC6: the reason %s is said in Polish, without the address, with only "Usuń z telefonu"',
    async (reason, textOf) => {
      const rig = stubPorts();
      rig.sync.items = [item({ reason: reason as QueueItem['reason'] })];
      await openQueue(rig);
      const card = screen.getByTestId('attention-m-s');
      expect(within(card).getByText(textOf)).toBeOnTheScreen();
      expect(within(card).getByText('Wizja lokalna')).toBeOnTheScreen();
      expect(within(card).getByTestId('attention-m-s-discard')).toBeOnTheScreen();
      for (const action of ['retarget', 'copy', 'recreate']) expect(screen.queryByTestId(`attention-m-s-${action}`)).toBeNull();
      expect(whole()).not.toMatch(ADDRESS);
      expect(String(card.props.accessibilityLabel)).toBe(`Wizja lokalna, wymaga uwagi: ${textOf}`);
    },
  );

  it('EVM-137 AC6: the dialog of a survey names what goes with it: "Razem z nią usuniemy z telefonu 4 elementy: 2 zdjęcia, 1 film i 1 wpis."', async () => {
    const rig = stubPorts();
    rig.sync.items = [item({ dependents: 4 })];
    rig.sync.summary = { photos: 2, videos: 1, entries: 1, total: 4 };
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-s-discard'));
    await settle();
    const dialog = screen.getByTestId('discard-dialog');
    expect(within(dialog).getByText('Usunąć wizję z telefonu?')).toBeOnTheScreen();
    expect(
      within(dialog).getByText(
        'Wizja nie zostanie wysłana. Razem z nią usuniemy z telefonu 4 elementy: 2 zdjęcia, 1 film i 1 wpis. Tego nie da się cofnąć.',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('discard-confirm'));
    await settle();
    expect(rig.sync.calls).toContain('discard:m-s');
  });

  it('EVM-137 AC6: a survey with nothing behind it says only that it will not be sent; one photo and one entry use the singular', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-s-discard'));
    await settle();
    expect(within(screen.getByTestId('discard-dialog')).getByText('Wizja nie zostanie wysłana. Tego nie da się cofnąć.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('discard-cancel'));
    rig.sync.summary = { photos: 1, videos: 0, entries: 1, total: 2 };
    rig.sync.items = [item({ dependents: 2 })];
    await act(() => {
      rig.sync.set({ lastSuccessAt: 9 });
    });
    await fireEvent.press(screen.getByTestId('attention-m-s-discard'));
    await settle();
    expect(
      within(screen.getByTestId('discard-dialog')).getByText(
        'Wizja nie zostanie wysłana. Razem z nią usuniemy z telefonu 2 elementy: 1 zdjęcie i 1 wpis. Tego nie da się cofnąć.',
      ),
    ).toBeOnTheScreen();
  });

  it('EVM-137 AC6: the dialog of an ordinary entry is as before (no regression)', async () => {
    const rig = stubPorts();
    rig.sync.items = [
      item({ id: 'm-n', type: 'CreateNote', reason: 'target_unavailable', actions: ['retarget', 'copy', 'discard'], label: 'x' }),
    ];
    await openQueue(rig);
    await fireEvent.press(screen.getByTestId('attention-m-n-discard'));
    await settle();
    expect(within(screen.getByTestId('discard-dialog')).getByText('Usunąć z telefonu?')).toBeOnTheScreen();
  });
});

describe('the items of a deleted survey (EVM-137 AC6, W10)', () => {
  it('EVM-137 AC6 W10: an entry of a deleted survey has the reason "Wizja została usunięta — wpis nie został wysłany." and only "Usuń z telefonu"', async () => {
    const rig = stubPorts();
    rig.sync.items = [
      item({ id: 'm-e', type: 'CreateNote', reason: 'survey_entry_unavailable', code: 'target_unavailable', label: 'Wpis' }),
    ];
    await openQueue(rig);
    const card = screen.getByTestId('attention-m-e');
    expect(within(card).getByText('Wizja została usunięta — wpis nie został wysłany.')).toBeOnTheScreen();
    expect(screen.queryByTestId('attention-m-e-retarget')).toBeNull();
    expect(screen.queryByTestId('attention-m-e-copy')).toBeNull();
  });

  it.each([
    ['survey_gone', 'photo', 'Wizja została usunięta — zdjęcie nie zostało wysłane.'],
    ['survey_gone', 'video', 'Wizja została usunięta — film nie został wysłany.'],
    ['order_gone', 'photo', 'Zlecenie zostało usunięte albo nie masz do niego dostępu — plik nie został wysłany.'],
    ['command_rejected', 'photo', 'Serwer nie przyjął tego pliku. Możesz usunąć go z telefonu.'],
  ] as const)(
    'EVM-137 AC6 W10: a file with the code %s (%s) has ONE row with the reason and "Usuń z telefonu"',
    async (code, mediaType, textOf) => {
      const rig = stubPorts();
      rig.media.set({ files: [file({ code, mediaType })], notifications: 'granted' });
      await openQueue(rig);
      const row = screen.getByTestId('file-attention-0194c2a0-0000-7000-8000-000000000f01');
      expect(within(row).getByText(textOf)).toBeOnTheScreen();
      expect(within(row).getByTestId('file-attention-0194c2a0-0000-7000-8000-000000000f01-discard')).toBeOnTheScreen();
      expect(screen.queryByTestId('file-attention-0194c2a0-0000-7000-8000-000000000f01-retry')).toBeNull();
      expect(screen.getAllByTestId('file-attention-0194c2a0-0000-7000-8000-000000000f01')).toHaveLength(1);
      expect(screen.queryAllByTestId('queue-row')).toHaveLength(0);
    },
  );

  it('EVM-137 W10: a file that waits behind a survey says "Wyślemy po utworzeniu wizji" - the same row, no address', async () => {
    const rig = stubPorts();
    rig.sync.items = [item({ state: 'pending', reason: null, code: null, actions: [], dependents: 1 })];
    rig.media.set({ files: [file({ status: 'waiting', code: null, actions: [], awaitsSurvey: true })], notifications: 'granted' });
    await openQueue(rig);
    expect(screen.getByText('Wyślemy po utworzeniu wizji')).toBeOnTheScreen();
    expect(whole()).not.toMatch(ADDRESS);
  });
});

describe('the hidden-data mode (EVM-137 AC5, W9)', () => {
  it('EVM-137 AC5: the queue shows the survey by its type and the reason - never the address - and "Usuń z telefonu" stays', async () => {
    const rig = stubPorts();
    rig.sync.items = [item()];
    rig.device.facts.secure = false;
    await openQueue(rig);
    const card = screen.getByTestId('attention-m-s');
    expect(within(card).getByTestId('attention-m-s-discard')).toBeOnTheScreen();
    expect(whole()).not.toMatch(ADDRESS);
  });
});
