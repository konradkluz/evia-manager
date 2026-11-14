import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../src/App';
import { type StartupChecker } from '../src/startup';
import { stubPorts } from './session-helpers';

// EVM-106 AC6: defence in depth - in the hidden-data mode the shell ignores "Wpis" and "Nowe zlecenie" even when the sheet reports them
// (the real sheet disables the rows; here it is replaced by one that does not, to prove the shell does not depend on it).
jest.mock('../src/screens/AddSheet', () => ({
  AddSheet: ({ onPick }: { onPick: (target: string) => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pressable, Text } = require('react-native') as typeof import('react-native');
    return (
      <>
        <Pressable
          onPress={() => {
            onPick('newOrder');
          }}
          testID="stub-pick-new-order"
        >
          <Text>new</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            onPick('entry');
          }}
          testID="stub-pick-entry"
        >
          <Text>entry</Text>
        </Pressable>
      </>
    );
  },
}));
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

describe('shell: the add sheet in the hidden-data mode (EVM-106 AC6)', () => {
  it.each(['stub-pick-new-order', 'stub-pick-entry'])('EVM-106 AC6: %s sets no form state while the data are hidden', async (testID) => {
    const rig = stubPorts();
    rig.device.facts.secure = false;
    await render(<App session={rig.session} checker={online} storage={() => ({ prepare: () => Promise.resolve('ready' as const) })} />);
    await settle();
    await fireEvent.press(screen.getByTestId('orders-add'));
    await fireEvent.press(screen.getByTestId(testID));
    await settle();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(screen.queryByTestId('quick-order-hidden')).toBeNull();
    expect(screen.queryByTestId('entry-picker')).toBeNull();
    expect(screen.queryByTestId('stub-pick-new-order')).toBeNull();
    expect(rig.sync.enqueued).toEqual([]);
    // the state of the form was not set either: after the data are visible again nothing opens by itself
    rig.device.facts.secure = true;
    await act(async () => {
      await rig.device.guard.refresh();
    });
    await settle();
    expect(screen.queryByTestId('quick-order')).toBeNull();
    expect(screen.queryByTestId('entry-picker')).toBeNull();
  });
});
