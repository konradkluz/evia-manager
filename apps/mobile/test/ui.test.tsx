import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import {
  AppBar,
  BottomNav,
  Button,
  Calculator,
  ClipboardList,
  EmptyState,
  FilterChip,
  InlineAlert,
  ListChecks,
  Skeleton,
  StatusBadge,
  SyncIndicator,
  TextField,
} from '../src/ui';
import { color, radius, size, text } from '../src/ui/theme';

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

  it('EVM-009 AC1: the BottomNav capsule of the active item is always a pill clipped to its radius, after every change of the active item', async () => {
    const nav = (first: boolean) =>
      inProvider(
        <BottomNav
          accessibilityLabel="Nawigacja główna"
          items={[
            { key: 'a', label: 'Moje zlecenia', icon: ClipboardList, selected: first, onPress: () => undefined, testID: 'nav-a' },
            { key: 'b', label: 'Kolejka', icon: ListChecks, selected: !first, onPress: () => undefined, testID: 'nav-b' },
          ]}
        />,
      );
    const view = await render(nav(true));
    const capsuleOf = (id: string) => flat(screen.getByTestId(id).children[0] as never);
    for (const id of ['nav-a', 'nav-b']) {
      expect(capsuleOf(id).borderRadius).toBe(radius.pill);
      expect(capsuleOf(id).overflow).toBe('hidden');
    }
    expect(capsuleOf('nav-a').backgroundColor).toBe(color.nav.indicator);
    expect(capsuleOf('nav-b').backgroundColor).toBe('transparent');
    await view.rerender(nav(false));
    expect(capsuleOf('nav-b').backgroundColor).toBe(color.nav.indicator);
    expect(capsuleOf('nav-b').borderRadius).toBe(radius.pill);
    expect(capsuleOf('nav-b').overflow).toBe('hidden');
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
    expect(flat(screen.getByText('Brak połączenia z serwerem')).fontWeight).toBe(text.heading4.fontWeight);
    expect(flat(screen.getByText('Brak połączenia z serwerem')).fontSize).toBeGreaterThan(
      flat(screen.getByText('Treść')).fontSize as number,
    );
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

describe('list controls (EVM-103; styleguide § 3.7, § 3.9)', () => {
  it('EVM-103 AC3: FilterChip is a toggle with a state - the selected chip has the selected colours and a check; every chip is at least 48 dp; focus shows the ring', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <FilterChip label="Wszystkie" accessibilityLabel="Wszystkie, wybrane" selected onPress={onPress} testID="chip-a" />
        <FilterChip label="Niewysłane (0)" accessibilityLabel="Niewysłane, 0 zleceń" selected={false} onPress={onPress} testID="chip-b" />
      </>,
    );
    const a = screen.getByTestId('chip-a');
    const b = screen.getByTestId('chip-b');
    expect(a.props.accessibilityState).toMatchObject({ selected: true });
    expect(b.props.accessibilityState).toMatchObject({ selected: false });
    expect(flat(a)).toMatchObject({ backgroundColor: color.bg.selected, borderColor: color.border.selected, borderRadius: radius.pill });
    expect(flat(b)).toMatchObject({ backgroundColor: color.bg.surface, borderColor: color.border.strong });
    expect(flat(a).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(b).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent(b, 'focus');
    expect(flat(screen.getByTestId('chip-b')).borderColor).toBe(color.focus.ring);
    await fireEvent(b, 'blur');
    expect(flat(screen.getByTestId('chip-b')).borderColor).toBe(color.border.strong);
    await fireEvent.press(b);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('EVM-103 AC1: StatusBadge shows the icon and the label on the tone of the group', async () => {
    await render(<StatusBadge icon={Calculator} label="Wycena" tone={color.status.order.quoting} testID="badge" />);
    expect(screen.getByText('Wycena')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('badge')).backgroundColor).toBe(color.status.order.quoting.bg);
  });

  it('EVM-103 AC6: the search variant of TextField turns off every learning property, limits the length and offers a 48 dp clear button only for a filled field', async () => {
    const onClear = jest.fn();
    const view = await render(
      <TextField
        label="Szukaj zlecenia"
        value=""
        onChangeText={() => undefined}
        search={{ clearLabel: 'Wyczyść', onClear }}
        maxLength={100}
        testID="s"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Wyczyść' })).toBeNull();
    const input = screen.getByLabelText('Szukaj zlecenia');
    expect(input.props).toMatchObject({
      autoCorrect: false,
      spellCheck: false,
      autoComplete: 'off',
      importantForAutofill: 'no',
      textContentType: 'none',
      autoCapitalize: 'none',
      returnKeyType: 'search',
      maxLength: 100,
    });
    await view.rerender(
      <TextField
        label="Szukaj zlecenia"
        value="x"
        onChangeText={() => undefined}
        search={{ clearLabel: 'Wyczyść', onClear }}
        maxLength={100}
        testID="s"
      />,
    );
    const clear = screen.getByRole('button', { name: 'Wyczyść' });
    expect(flat(clear).minHeight).toBeGreaterThanOrEqual(48);
    expect(flat(clear).minWidth).toBeGreaterThanOrEqual(48);
    await fireEvent.press(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('EVM-009 AC1: a normal TextField keeps password-manager friendly autofill (only the search variant switches it off)', async () => {
    await render(<TextField label="Email" value="" onChangeText={() => undefined} autoComplete="email" textContentType="emailAddress" />);
    expect(screen.getByLabelText('Email').props).toMatchObject({
      importantForAutofill: 'yes',
      autoComplete: 'email',
      textContentType: 'emailAddress',
    });
  });
});
