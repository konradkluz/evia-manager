import { useState } from 'react';
import { Pressable } from 'react-native';
import { Icon } from './Icon';
import { Circle } from './icons';
import { borderWidth, color, radius, size } from './theme';

export interface CameraShutterProps {
  /** The accessible name ("Zrób zdjęcie"). */
  accessibilityLabel: string;
  /** Why the shutter does nothing right now ("Wybierz kategorię przed zdjęciem."); read after the name. */
  accessibilityHint?: string;
  onPress: () => void;
  /** Not pressable: the outline turns dashed and the icon grey (the reason is also visible as a text of the screen, never the outline alone). */
  disabled?: boolean;
  testID?: string;
}

/**
 * The shutter of the camera (styleguide § 3.24): `size.touch-target.shutter`, `radius.pill`, outline `color.border.inverse` of `border-width.indicator`,
 * the `circle` icon of `size.icon.xl` in `color.icon.inverse`. The focus ring is the inverse one (`color.focus.ring-inverse`); pressed = `color.bg.brand`.
 */
export function CameraShutter({ accessibilityLabel, accessibilityHint, onPress, disabled = false, testID }: CameraShutterProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
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
        width: size.touchTarget.shutter,
        height: size.touchTarget.shutter,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: borderWidth.indicator,
        borderStyle: disabled ? 'dashed' : 'solid',
        borderColor: focused ? color.focus.ringInverse : color.border.inverse,
        backgroundColor: pressed || focused ? color.bg.brand : 'transparent',
      })}
    >
      <Icon icon={Circle} color={disabled ? color.icon.disabled : color.icon.inverse} iconSize="xl" />
    </Pressable>
  );
}
