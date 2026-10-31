import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { pl } from '../src/i18n/pl';
import { LocalDataGate, LocalDataLostScreen, type WipePreparer } from '../src/screens/LocalDataScreens';
import { size } from '../src/ui/theme';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('screens of the local store (EVM-093 AC5, AC6)', () => {
  it('EVM-093 AC5: one blocking message with the exact text and a single action "Rozumiem" of at least 48 dp', async () => {
    const onAcknowledge = jest.fn();
    await render(inProvider(<LocalDataLostScreen onAcknowledge={onAcknowledge} />));
    expect(`${pl.localData.lostTitle} ${pl.localData.lostBody}`).toBe(
      'Dane zapisane na tym telefonie, które nie zostały wysłane, są niedostępne. Dane zleceń pobierzemy ponownie.',
    );
    expect(screen.getByRole('header', { name: pl.localData.lostTitle })).toBeOnTheScreen();
    expect(screen.getByText(pl.localData.lostBody)).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const ack = screen.getByRole('button', { name: 'Rozumiem' });
    expect(flat(ack).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    await fireEvent.press(ack);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('EVM-093 AC6: without a wipe in progress the gate shows the app after the check and nothing before it', async () => {
    let finish: (value: 'ready') => void = () => undefined;
    const storage: WipePreparer = { prepare: () => new Promise((resolve) => (finish = resolve)) };
    await render(inProvider(<LocalDataGate storage={() => storage}>{<Text>app-content</Text>}</LocalDataGate>));
    expect(screen.queryByText('app-content')).toBeNull();
    expect(screen.queryByText(pl.localData.wiping)).toBeNull();
    finish('ready');
    await settle();
    expect(screen.getByText('app-content')).toBeOnTheScreen();
  });

  it('EVM-093 AC6: an interrupted wipe shows "Kończymy czyszczenie…" and the app only after it finished', async () => {
    let finish: (value: 'ready') => void = () => undefined;
    const storage: WipePreparer = {
      prepare: (onResume) => {
        onResume?.();
        return new Promise((resolve) => (finish = resolve));
      },
    };
    await render(inProvider(<LocalDataGate storage={() => storage}>{<Text>app-content</Text>}</LocalDataGate>));
    expect(screen.getByRole('header', { name: 'Kończymy czyszczenie…' })).toBeOnTheScreen();
    expect(screen.queryByText('app-content')).toBeNull();
    finish('ready');
    await settle();
    expect(screen.getByText('app-content')).toBeOnTheScreen();
  });

  it('EVM-093 AC6: a wipe that cannot finish keeps the app closed and offers a retry', async () => {
    const results: ('ready' | 'wipe_incomplete')[] = ['wipe_incomplete', 'ready'];
    const prepare = jest.fn((onResume?: () => void) => {
      onResume?.();
      return Promise.resolve(results.shift() ?? 'ready');
    });
    await render(inProvider(<LocalDataGate storage={() => ({ prepare })}>{<Text>app-content</Text>}</LocalDataGate>));
    await settle();
    expect(screen.queryByText('app-content')).toBeNull();
    const retry = screen.getByRole('button', { name: pl.localData.wipingRetry });
    expect(flat(retry).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    await fireEvent.press(retry);
    await settle();
    expect(await screen.findByText('app-content')).toBeOnTheScreen();
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
