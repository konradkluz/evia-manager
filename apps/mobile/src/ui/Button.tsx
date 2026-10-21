import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { borderWidth, color, radius, size, space, text } from './theme';

export type ButtonVariant = 'primary' | 'tertiary';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `lg` is the main action in the field (56 dp, bottom bar). */
  buttonSize?: 'md' | 'lg';
  disabled?: boolean;
  testID?: string;
}

/** Button (styleguide § 3.1), mobile sizes md 48 dp and lg 56 dp; the focus ring is shown for keyboard and switch access. */
export function Button({ label, onPress, variant = 'primary', buttonSize = 'md', disabled = false, testID }: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const tokens = color.action[variant];
  const labelColor = disabled ? tokens.textDisabled : tokens.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: size.control.height.mobile[buttonSize],
        minWidth: size.touchTarget.min,
        paddingHorizontal: space.inset.md,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: focused ? size.focusRing.width : borderWidth.default,
        borderColor: focused ? color.focus.ring : 'transparent',
        backgroundColor: backgroundFor(variant, disabled, pressed),
      })}
    >
      <Text style={{ ...text.button, color: labelColor, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function backgroundFor(variant: ButtonVariant, disabled: boolean, pressed: boolean): string {
  if (variant === 'primary') {
    const { bg, bgPressed, bgDisabled } = color.action.primary;
    return disabled ? bgDisabled : pressed ? bgPressed : bg;
  }
  return pressed && !disabled ? color.action.tertiary.bgPressed : 'transparent';
}
