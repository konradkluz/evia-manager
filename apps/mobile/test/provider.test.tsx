import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { FOREGROUND_DEBOUNCE_MS, SLOW_CHECK_MS, StartupProvider, useStartup } from '../src/startup';
import type { StartupChecker, StartupState } from '../src/startup';

type Listener = (state: string) => void;
let listeners: Listener[] = [];
const removed = jest.fn();

function Probe() {
  const { state, checking, slow, retry } = useStartup();
  return (
    <>
      <Text testID="state">{state.kind}</Text>
      <Text testID="checking">{String(checking)}</Text>
      <Text testID="slow">{String(slow)}</Text>
      <Text testID="retry" onPress={retry}>
        retry
      </Text>
    </>
  );
}

function deferred() {
  let resolve!: (state: StartupState) => void;
  const promise = new Promise<StartupState>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const text = (id: string) => screen.getByTestId(id).props.children as string;
const foreground = () => {
  listeners.forEach((listener) => {
    listener('active');
  });
};

describe('startup provider (EVM-009 AC2, AC3)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listeners = [];
    removed.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as Listener);
      return { remove: removed };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('EVM-009 AC2: the first check starts at launch and its result replaces "checking"', async () => {
    const first = deferred();
    const checker = jest.fn<ReturnType<StartupChecker>, []>(() => first.promise);
    await render(
      <StartupProvider checker={checker}>
        <Probe />
      </StartupProvider>,
    );
    expect(text('state')).toBe('checking');
    expect(text('checking')).toBe('true');
    await act(async () => {
      first.resolve({ kind: 'online' });
      await first.promise;
    });
    expect(text('state')).toBe('online');
    expect(text('checking')).toBe('false');
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('EVM-009 AC2: a checker that throws gives "server unavailable" instead of a crash', async () => {
    await render(
      <StartupProvider checker={() => Promise.reject(new Error('boom'))}>
        <Probe />
      </StartupProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(text('state')).toBe('serverUnavailable');
  });

  it('EVM-009 AC2: a slow first check is reported after the limit and cleared when it ends', async () => {
    const first = deferred();
    await render(
      <StartupProvider checker={() => first.promise}>
        <Probe />
      </StartupProvider>,
    );
    expect(text('slow')).toBe('false');
    await act(() => {
      jest.advanceTimersByTime(SLOW_CHECK_MS);
    });
    expect(text('slow')).toBe('true');
    await act(async () => {
      first.resolve({ kind: 'offline' });
      await first.promise;
    });
    expect(text('slow')).toBe('false');
  });

  it('EVM-009 AC2: coming back to the foreground repeats the check after the debounce time, not before, and never loops', async () => {
    const checker = jest.fn<Promise<StartupState>, []>(() => Promise.resolve({ kind: 'offline' }));
    await render(
      <StartupProvider checker={checker}>
        <Probe />
      </StartupProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(checker).toHaveBeenCalledTimes(1);
    await act(() => {
      foreground();
    });
    expect(checker).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(FOREGROUND_DEBOUNCE_MS);
      foreground();
      await Promise.resolve();
    });
    expect(checker).toHaveBeenCalledTimes(2);
    await act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(checker).toHaveBeenCalledTimes(2);
  });

  it('EVM-009 AC2: other app states do not start a check', async () => {
    const checker = jest.fn<Promise<StartupState>, []>(() => Promise.resolve({ kind: 'online' }));
    await render(
      <StartupProvider checker={checker}>
        <Probe />
      </StartupProvider>,
    );
    await act(() => {
      jest.advanceTimersByTime(FOREGROUND_DEBOUNCE_MS);
      listeners.forEach((listener) => {
        listener('background');
      });
    });
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('EVM-009 AC2: "try again" repeats the check on demand, keeps the earlier state visible meanwhile and ignores a second press while it runs', async () => {
    const second = deferred();
    const checker = jest
      .fn<Promise<StartupState>, []>()
      .mockResolvedValueOnce({ kind: 'serverUnavailable', problem: 'timeout' })
      .mockReturnValueOnce(second.promise);
    await render(
      <StartupProvider checker={checker}>
        <Probe />
      </StartupProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(text('state')).toBe('serverUnavailable');
    await fireEvent.press(screen.getByTestId('retry'));
    await fireEvent.press(screen.getByTestId('retry'));
    expect(checker).toHaveBeenCalledTimes(2);
    expect(text('state')).toBe('serverUnavailable');
    expect(text('checking')).toBe('true');
    await act(async () => {
      second.resolve({ kind: 'online' });
      await second.promise;
    });
    expect(text('state')).toBe('online');
    expect(text('checking')).toBe('false');
  });

  it('EVM-009 AC2: the result of a check that ends after unmount is dropped and the listener is removed', async () => {
    const first = deferred();
    const view = await render(
      <StartupProvider checker={() => first.promise}>
        <Probe />
      </StartupProvider>,
    );
    await view.unmount();
    expect(removed).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ kind: 'online' });
      await first.promise;
    });
  });

  it('EVM-009 AC2: using the hook outside the provider is a programming error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow('StartupProvider');
    error.mockRestore();
  });
});
