import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Check } from './icons';
import { Icon } from './Icon';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface FilterChipProps {
  /** Visible text ("Niewysłane (3)"). */
  label: string;
  /** Full accessible name with the state ("Niewysłane, 3 zlecenia, wybrane"). */
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Filter chip (styleguide § 3.7): `radius.pill`, height `size.touch-target.min`, a toggle with a state - the selected chip has
 * `color.bg.selected`, `color.border.selected` and a check mark (the state is never colour alone).
 */
export function FilterChip({ label, accessibilityLabel, selected, onPress, testID }: FilterChipProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      testID={testID}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: space.inline.sm,
        minHeight: size.touchTarget.min,
        paddingHorizontal: space.inset.md,
        borderRadius: radius.pill,
        borderWidth: focused ? size.focusRing.width : selected ? borderWidth.strong : borderWidth.default,
        borderColor: focused ? color.focus.ring : selected ? color.border.selected : color.border.strong,
        backgroundColor: selected ? color.bg.selected : pressed ? color.bg.surfacePressed : color.bg.surface,
      })}
    >
      {selected ? <Icon icon={Check} color={color.icon.primary} iconSize="md" /> : null}
      <Text style={{ ...text.labelLg, color: color.text.primary }}>{label}</Text>
    </Pressable>
  );
}
