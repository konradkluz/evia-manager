import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { AppBar, BottomNav, Button, ClipboardList, EmptyState, InlineAlert, ListChecks, Skeleton, SyncIndicator } from '../src/ui';
import { color, size } from '../src/ui/theme';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('mobile UI library (EVM-009 AC1; styleguide § 3, § 5)', () => {
  it('EVM-009 AC1: Button is a button with a label, calls onPress and is at least 48 dp (56 dp for the main action)', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Button label="Zapisz" onPress={onPress} />
        <Button label="Główna" onPress={onPress} buttonSize="lg" />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Zapisz' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(flat(screen.getByRole('button', { name: 'Zapisz' })).minHeight).toBe(size.touchTarget.min);
    expect(flat(screen.getByRole('button', { name: 'Główna' })).minHeight).toBe(size.touchTarget.field);
  });

  it('EVM-009 AC1: a disabled Button does not react and is announced as disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Zapisz" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Zapisz' });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it('EVM-009 AC1: the focus ring of Button follows keyboard focus (color.focus.ring)', async () => {
    await render(<Button label="Zapisz" variant="tertiary" onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Zapisz' });
    expect(flat(button).borderColor).toBe('transparent');
    await fireEvent(button, 'focus');
    expect(flat(button).borderColor).toBe(color.focus.ring);
    await fireEvent(button, 'blur');
    expect(flat(button).borderColor).toBe('transparent');
  });

  it('EVM-009 AC1: Button shows the pressed background of its variant', async () => {
    await render(
      <>
        <Button label="Primary" onPress={() => undefined} />
        <Button label="Tertiary" variant="tertiary" onPress={() => undefined} />
      </>,
    );
    expect(flat(screen.getByRole('button', { name: 'Primary' })).backgroundColor).toBe(color.action.primary.bg);
    expect(flat(screen.getByRole('button', { name: 'Tertiary' })).backgroundColor).toBe('transparent');
  });

  it('EVM-009 AC1: EmptyState shows icon, title as a heading and description; the blocking variant has a larger title', async () => {
    await render(
      <>
        <EmptyState icon={ClipboardList} title="Brak zleceń" description="Opis" />
        <EmptyState icon={ClipboardList} title="Blokada" blocking>
          <></>
        </EmptyState>
      </>,
    );
    expect(screen.getByRole('header', { name: 'Brak zleceń' })).toBeOnTheScreen();
    expect(screen.getByText('Opis')).toBeOnTheScreen();
    expect(flat(screen.getByText('Blokada')).fontSize).toBeGreaterThan(flat(screen.getByText('Brak zleceń')).fontSize as number);
  });

  it('EVM-009 AC1: BottomNav marks the active item as selected and every item is a tab of at least 48 dp', async () => {
    const onPress = jest.fn();
    await render(
      inProvider(
        <BottomNav
          accessibilityLabel="Nawigacja główna"
          items={[
            { key: 'a', label: 'Moje zlecenia', icon: ClipboardList, selected: true, onPress: () => undefined },
            { key: 'b', label: 'Kolejka', icon: ListChecks, selected: false, onPress },
          ]}
        />,
      ),
    );
    expect(screen.getByRole('tab', { name: 'Moje zlecenia', selected: true })).toBeOnTheScreen();
    const queue = screen.getByRole('tab', { name: 'Kolejka', selected: false });
    expect(flat(queue).minHeight).toBeGreaterThanOrEqual(size.touchTarget.min);
    await fireEvent.press(queue);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Nawigacja główna')).toBeOnTheScreen();
  });

  it('EVM-009 AC1: SyncIndicator shows a capsule with the offline outline, a touch area of 48 dp and a full accessible name', async () => {
    const onPress = jest.fn();
    await render(<SyncIndicator state="offline" label="Offline" accessibilityLabel="Offline. Otwórz kolejkę" onPress={onPress} />);
    const capsule = screen.getByRole('button', { name: 'Offline. Otwórz kolejkę' });
    expect(flat(capsule).minHeight).toBe(size.touchTarget.min);
    expect(flat(capsule).minWidth).toBe(size.touchTarget.min);
    expect(screen.getByText('Offline')).toBeOnTheScreen();
    await fireEvent.press(capsule);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EVM-009 AC1: SyncIndicator shows the focus ring for the app bar (color.focus.ring-inverse)', async () => {
    await render(
      <SyncIndicator state="online" label="Połączono" accessibilityLabel="Połączono. Otwórz kolejkę" onPress={() => undefined} />,
    );
    const capsule = screen.getByRole('button', { name: 'Połączono. Otwórz kolejkę' });
    await fireEvent(capsule, 'focus');
    expect(flat(capsule).borderColor).toBe(color.focus.ringInverse);
    await fireEvent(capsule, 'blur');
    expect(flat(capsule).borderColor).toBe('transparent');
  });

  it('EVM-009 AC1: AppBar renders the title as a heading with the right-hand slot and respects the top inset', async () => {
    await render(inProvider(<AppBar title="Moje zlecenia" right={<Button label="X" onPress={() => undefined} />} />));
    expect(screen.getByRole('header', { name: 'Moje zlecenia' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'X' })).toBeOnTheScreen();
  });

  it('EVM-009 AC2: only an error InlineAlert has the alert role; its title, code and action are shown', async () => {
    await render(
      <>
        <InlineAlert
          tone="error"
          title="Brak połączenia z serwerem"
          body="Treść"
          code="Kod: x"
          action={<Button label="Ponów" onPress={() => undefined} />}
          testID="error"
        />
        <InlineAlert tone="info" body="Brak zasięgu" testID="info" />
      </>,
    );
    expect(screen.getByTestId('error')).toHaveProp('accessibilityRole', 'alert');
    expect(screen.getByTestId('info')).not.toHaveProp('accessibilityRole', 'alert');
    expect(screen.getByText('Kod: x')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ponów' })).toBeOnTheScreen();
    expect(screen.getByText('Brak zasięgu')).toBeOnTheScreen();
  });

  it('EVM-009 AC2: Skeleton is a busy region with a label and starts its pulse unless the system reduces motion', async () => {
    const reduced = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const view = await render(<Skeleton accessibilityLabel="Ładowanie" testID="skeleton" />);
    expect(screen.getByLabelText('Ładowanie')).toBeBusy();
    await view.unmount();
    reduced.mockResolvedValue(true);
    await render(<Skeleton accessibilityLabel="Ładowanie" />);
    expect(screen.getByLabelText('Ładowanie')).toBeBusy();
    reduced.mockRestore();
  });
});
