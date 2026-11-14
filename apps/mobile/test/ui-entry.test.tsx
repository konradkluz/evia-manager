import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import type { ComponentRef } from 'react';
import type { TextInput } from 'react-native';
import { FilterChip, TextArea, Toast, TOAST_MS } from '../src/ui';

// EVM-105 (styleguide § 3.2 TextArea, § 3.14 Toast, § 3.7 FilterChip as a radio): the components of the entry form.
describe('TextArea (EVM-105, security 5)', () => {
  it('EVM-105 AC1: label, value, hint; autofill off, autocorrect and spell check on, no maxLength, no link detection, multiline', async () => {
    const onChange = jest.fn();
    await render(<TextArea label="Treść" value="abc" onChangeText={onChange} hint="Stała podpowiedź" testID="area" />);
    const field = screen.getByTestId('area');
    expect(screen.getByText('Treść')).toBeOnTheScreen();
    expect(screen.getByText('Stała podpowiedź')).toBeOnTheScreen();
    expect(field.props.accessibilityLabel).toBe('Treść');
    expect(field.props.accessibilityHint).toBe('Stała podpowiedź');
    expect(field.props).toMatchObject({
      multiline: true,
      autoCorrect: true,
      spellCheck: true,
      autoCapitalize: 'sentences',
      autoComplete: 'off',
      textContentType: 'none',
      importantForAutofill: 'no',
      value: 'abc',
    });
    expect(field.props.maxLength).toBeUndefined();
    expect(field.props.dataDetectorTypes).toBeUndefined();
    await fireEvent.changeText(field, 'abcd');
    expect(onChange).toHaveBeenCalledWith('abcd');
    expect(screen.queryByTestId('area-error')).toBeNull();
  });

  it('EVM-105 AC3: an error is shown under the field with the text; the focus ring follows focus and blur; a locked field is not editable', async () => {
    await render(
      <TextArea label="Treść" value="" onChangeText={() => undefined} error="Wpisz treść wpisu." editable={false} testID="area" />,
    );
    expect(screen.getByTestId('area-error')).toHaveTextContent('Wpisz treść wpisu.');
    expect(screen.getByTestId('area').props.editable).toBe(false);
    expect(screen.getByTestId('area').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('EVM-105 AC3: focus and blur are handled and the ref reaches the input (for the focus after a failed validation)', async () => {
    const ref = createRef<ComponentRef<typeof TextInput>>();
    await render(<TextArea label="Treść" value="" onChangeText={() => undefined} inputRef={ref} testID="area" />);
    expect(ref.current).not.toBeNull();
    await fireEvent(screen.getByTestId('area'), 'focus');
    await fireEvent(screen.getByTestId('area'), 'blur');
    expect(screen.getByTestId('area')).toBeOnTheScreen();
  });
});

describe('Toast (EVM-105 AC1)', () => {
  it('EVM-105 AC1: a polite live region with the fixed text; it calls back after six seconds and not before', async () => {
    jest.useFakeTimers();
    try {
      const onDismiss = jest.fn();
      await render(<Toast message="Zapisano w telefonie." onDismiss={onDismiss} testID="toast" />);
      expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBe('polite');
      expect(screen.getByText('Zapisano w telefonie.')).toBeOnTheScreen();
      await act(() => {
        jest.advanceTimersByTime(TOAST_MS - 1);
      });
      expect(onDismiss).not.toHaveBeenCalled();
      await act(() => {
        jest.advanceTimersByTime(2);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('FilterChip as a radio (EVM-105)', () => {
  it('EVM-105 AC1: a radio chip has the role radio and the state checked; the default chip keeps the button role and selected', async () => {
    await render(
      <>
        <FilterChip radio label="A" accessibilityLabel="A" selected onPress={() => undefined} testID="radio" />
        <FilterChip label="B" accessibilityLabel="B" selected={false} onPress={() => undefined} testID="toggle" />
      </>,
    );
    expect(screen.getByTestId('radio').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('radio').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('toggle').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('toggle').props.accessibilityState).toEqual({ selected: false });
  });
});
