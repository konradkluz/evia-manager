import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { borderWidth, color, radius, size, space, text } from './theme';

export type ButtonVariant = 'primary' | 'tertiary' | 'danger' | 'dangerTertiary';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `lg` is the main action in the field (56 dp, bottom bar). */
  buttonSize?: 'md' | 'lg';
  disabled?: boolean;
  /** A request is running: the press is blocked, the label stays, the state is announced (styleguide § 3.1 "ładowanie"). */
  busy?: boolean;
  /** Tertiary button on `color.bg.brand` (M-01): text `color.text.on-brand`, inverse focus ring (styleguide § 3.2.1). */
  inverse?: boolean;
  /** Stretches to the full width of the bottom bar (styleguide § 3.1 mobile). */
  fullWidth?: boolean;
  testID?: string;
}

/** Button (styleguide § 3.1), mobile sizes md 48 dp and lg 56 dp; the focus ring is shown for keyboard and switch access. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  buttonSize = 'md',
  disabled = false,
  busy = false,
  inverse = false,
  fullWidth = false,
  testID,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
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
        ...(fullWidth ? { alignSelf: 'stretch' as const } : {}),
        borderWidth: focused ? size.focusRing.width : borderWidth.default,
        borderColor: focused ? (inverse ? color.focus.ringInverse : color.focus.ring) : 'transparent',
        backgroundColor: backgroundFor(variant, disabled, pressed, inverse),
      })}
    >
      <Text style={{ ...text.button, color: labelColor(variant, disabled, inverse), textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

function labelColor(variant: ButtonVariant, disabled: boolean, inverse: boolean): string {
  if (variant === 'dangerTertiary') return disabled ? color.action.tertiary.textDisabled : color.action.danger.textSubtle;
  if (variant === 'tertiary' && inverse && !disabled) return color.text.onBrand;
  const tokens = color.action[variant];
  return disabled ? tokens.textDisabled : tokens.text;
}

function backgroundFor(variant: ButtonVariant, disabled: boolean, pressed: boolean, inverse: boolean): string {
  if (variant === 'primary' || variant === 'danger') {
    const { bg, bgPressed, bgDisabled } = color.action[variant];
    return disabled ? bgDisabled : pressed ? bgPressed : bg;
  }
  if (!pressed || disabled) return 'transparent';
  return inverse ? color.bg.brandStrong : color.action.tertiary.bgPressed;
}
