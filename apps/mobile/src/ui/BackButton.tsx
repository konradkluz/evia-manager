import { useState } from 'react';
import { Pressable } from 'react-native';
import { Icon } from './Icon';
import { ArrowLeft } from './icons';
import { color, radius, size } from './theme';

/**
 * The back action of the app bar (styleguide § 3.18): the `arrow-left` icon in a 48 x 48 dp target, never a text that would take the room of the title at a large font.
 * The name for the screen reader is always given by the screen ("Wróć do zlecenia"). Inverse focus ring, like everything on the bar.
 */
export function BackButton({ accessibilityLabel, onPress, testID }: { accessibilityLabel: string; onPress: () => void; testID?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      testID={testID}
      style={({ pressed }) => ({
        minWidth: size.touchTarget.min,
        minHeight: size.touchTarget.min,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: size.focusRing.width,
        borderColor: focused ? color.focus.ringInverse : 'transparent',
        backgroundColor: pressed ? color.bg.brand : 'transparent',
        flexShrink: 0,
      })}
    >
      <Icon icon={ArrowLeft} color={color.text.onBrand} />
    </Pressable>
  );
}
