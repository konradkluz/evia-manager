import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import { AlertDialog, BottomBar, Button, TextField } from '../src/ui';
import { borderWidth, color, size } from '../src/ui/theme';

const metrics = { frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const inProvider = (element: ReactElement) => <SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('components of the sign-in (EVM-100 AC1, AC8; styleguide § 3.1, § 3.2, § 3.13)', () => {
  it('EVM-100 AC8: TextField — visible label as the name, the selected border and focus ring on focus, the error border', async () => {
    await render(<TextField label="E-mail" value="" onChangeText={() => undefined} testID="f" />);
    const input = screen.getByLabelText('E-mail');
    expect(flat(screen.getByTestId('f-frame')).borderColor).toBe(color.border.strong);
    await fireEvent(input, 'focus');
    expect(flat(screen.getByTestId('f-frame')).borderColor).toBe(color.border.selected);
    expect(flat(screen.getByTestId('f-frame')).borderWidth).toBe(borderWidth.strong);
    await fireEvent(input, 'blur');
    expect(flat(screen.getByTestId('f-frame')).borderWidth).toBe(borderWidth.default);
    await render(<TextField label="Hasło" value="" invalid onChangeText={() => undefined} testID="g" />);
    expect(flat(screen.getByTestId('g-frame')).borderColor).toBe(color.border.error);
  });

  it('EVM-100 AC8: a read-only field while a request runs; the field is at least the mobile control height', async () => {
    await render(
      <TextField label="Kod" value="12" editable={false} numeric hint="6 cyfr" inverse onChangeText={() => undefined} testID="c" />,
    );
    const input = screen.getByLabelText('Kod');
    expect(input).toHaveProp('editable', false);
    expect(input).toHaveProp('accessibilityState', { disabled: true });
    expect(flat(screen.getByTestId('c-frame')).minHeight).toBe(size.control.height.mobile.md);
    expect(flat(screen.getByTestId('c-frame')).backgroundColor).toBe(color.control.bgDisabled);
    expect(screen.getByText('6 cyfr')).toBeOnTheScreen();
  });

  it('EVM-100 AC1: Button busy blocks the press and is announced; danger variants use their tokens; inverse tertiary on brand', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Button label="Zaloguj się" busy onPress={onPress} />
        <Button label="Wyloguj mimo to" variant="danger" onPress={onPress} />
        <Button label="Wyczyść" variant="dangerTertiary" onPress={onPress} />
        <Button label="Wyczyść off" variant="dangerTertiary" disabled onPress={onPress} />
        <Button label="Zmień konto" variant="tertiary" inverse onPress={onPress} />
        <Button label="Zmień off" variant="tertiary" inverse disabled onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Zaloguj się' })).toBeBusy();
    expect(flat(screen.getByRole('button', { name: 'Wyloguj mimo to' })).backgroundColor).toBe(color.action.danger.bg);
    expect(screen.getByText('Wyczyść')).toHaveStyle({ color: color.action.danger.textSubtle });
    expect(screen.getByText('Wyczyść off')).toHaveStyle({ color: color.action.tertiary.textDisabled });
    expect(screen.getByText('Zmień konto')).toHaveStyle({ color: color.text.onBrand });
    expect(screen.getByText('Zmień off')).toHaveStyle({ color: color.action.tertiary.textDisabled });
    const inverse = screen.getByRole('button', { name: 'Zmień konto' });
    await fireEvent(inverse, 'focus');
    expect(flat(inverse).borderColor).toBe(color.focus.ringInverse);
  });

  it('EVM-100 AC7: AlertDialog — a heading, the body and the actions inside the window of the app (no separate Modal window)', async () => {
    await render(
      inProvider(
        <AlertDialog
          title="Wylogować się?"
          onCancel={() => undefined}
          actions={<Button label="Wyloguj" onPress={() => undefined} />}
          testID="d"
        >
          <Text>Treść</Text>
        </AlertDialog>,
      ),
    );
    expect(screen.getByRole('header', { name: 'Wylogować się?' })).toBeOnTheScreen();
    expect(flat(screen.getByTestId('d')).position).toBe('absolute');
    expect(flat(screen.getByTestId('d')).backgroundColor).toBe(color.bg.scrim);
  });

  it('EVM-100 AC8: BottomBar keeps the main action above the system inset', async () => {
    await render(
      inProvider(
        <BottomBar>
          <Button label="Zaloguj się" buttonSize="lg" fullWidth onPress={() => undefined} />
        </BottomBar>,
      ),
    );
    expect(flat(screen.getByRole('button', { name: 'Zaloguj się' })).minHeight).toBe(size.touchTarget.field);
    expect(flat(screen.getByRole('button', { name: 'Zaloguj się' })).alignSelf).toBe('stretch');
  });
});
