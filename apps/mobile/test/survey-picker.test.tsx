import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { App } from '../src/App';
import { type StartupChecker } from '../src/startup';
import { stubPorts } from './session-helpers';

// EVM-137 AC3, AC4 (security W5, W9): "Do którego zlecenia?" of the camera lists a survey by its number (or "Oczekuje na numer"), the mark and
// the date of creation - never the address, never the title. Synthetic data only.
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
const CREATED = Date.UTC(2026, 10, 16, 12, 0, 0);

async function openPicker(setup: (rig: ReturnType<typeof stubPorts>) => void, secure = true) {
  const rig = stubPorts();
  rig.device.facts.secure = secure;
  setup(rig);
  await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
  await settle();
  await fireEvent.press(screen.getByTestId('orders-add'));
  await settle();
  await fireEvent.press(screen.getByTestId('add-media'));
  await settle();
  return rig;
}

describe('the picker of the order for the camera (EVM-137)', () => {
  it('EVM-137 AC4: a survey is "number · Wizja lokalna · Założono 16.11.2026"; one that waits is "Oczekuje na numer · Wizja lokalna · …"; an ordinary order keeps its title', async () => {
    await openPicker((rig) => {
      rig.sync.targets = [
        { id: 'o-1', number: 'ZL-2026-0042', title: 'Garaż — pełny proces' },
        { id: 'o-s', number: 'ZL-2026-0051', title: '', survey: { createdAt: CREATED, awaitingNumber: false } },
        { id: 'o-w', number: '', title: '', survey: { createdAt: CREATED, awaitingNumber: true } },
      ];
    });
    const picker = screen.getByTestId('media-picker');
    expect(within(picker).getByTestId('media-picker-o-1')).toHaveTextContent('ZL-2026-0042 · Garaż — pełny proces');
    expect(within(picker).getByTestId('media-picker-o-s')).toHaveTextContent('ZL-2026-0051 · Wizja lokalna · Założono 16.11.2026');
    expect(within(picker).getByTestId('media-picker-o-w')).toHaveTextContent('Oczekuje na numer · Wizja lokalna · Założono 16.11.2026');
  });

  it('EVM-137 AC4 W5: a survey is found by its number; nothing of an address is on the picker', async () => {
    await openPicker((rig) => {
      rig.sync.targets = [{ id: 'o-s', number: 'ZL-2026-0051', title: '', survey: { createdAt: CREATED, awaitingNumber: false } }];
    });
    await fireEvent.changeText(screen.getByTestId('media-picker-search'), '0051');
    expect(screen.getByTestId('media-picker-o-s')).toBeOnTheScreen();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/Fikcyjna|Piaseczno/);
  });

  it('EVM-137 AC5 W9: in the hidden-data mode a survey is only a number (or "Oczekuje na numer") - no mark, no date; the camera still can be chosen', async () => {
    await openPicker((rig) => {
      rig.sync.targets = [
        { id: 'o-s', number: 'ZL-2026-0051', title: 'x', survey: { createdAt: CREATED, awaitingNumber: false } },
        { id: 'o-w', number: '', title: '', survey: { createdAt: CREATED, awaitingNumber: true } },
      ];
    }, false);
    const picker = screen.getByTestId('media-picker');
    expect(within(picker).getByTestId('media-picker-o-s')).toHaveTextContent(/^ZL-2026-0051$/);
    expect(within(picker).getByTestId('media-picker-o-w')).toHaveTextContent(/^Oczekuje na numer$/);
    expect(within(picker).queryByText(/Wizja lokalna|Założono/)).toBeNull();
  });
});
