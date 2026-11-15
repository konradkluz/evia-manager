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
  /** A member of a single-choice group (radio): the role is `radio` and the state is `checked`; the group itself is a `radiogroup` of the screen. */
  radio?: boolean;
  /** The variant on the dark panel of the camera (styleguide § 3.24): outline `color.border.inverse`, text `color.text.on-brand`; selected = `color.bg.surface` with the dark text and the check mark. */
  onDark?: boolean;
  /** Not pressable (EVM-110: during a recording and for "Film" without room): the outline turns dashed and the text grey; the reason is also a text of the screen. */
  disabled?: boolean;
  testID?: string;
}

/**
 * Filter chip (styleguide § 3.7): `radius.pill`, height `size.touch-target.min`, a toggle with a state - the selected chip has
 * `color.bg.selected`, `color.border.selected` and a check mark (the state is never colour alone).
 */
export function FilterChip({
  label,
  accessibilityLabel,
  selected,
  onPress,
  radio = false,
  onDark = false,
  disabled = false,
  testID,
}: FilterChipProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...(radio ? { checked: selected } : { selected }), ...(disabled ? { disabled: true } : {}) }}
      disabled={disabled ? true : undefined}
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
        ...(onDark ? onDarkLook(selected, focused, pressed) : onLightLook(selected, focused, pressed)),
        ...(disabled ? { borderStyle: 'dashed' as const } : {}),
      })}
    >
      {selected ? <Icon icon={Check} color={color.icon.primary} iconSize="md" /> : null}
      <Text
        style={{ ...text.labelLg, color: disabled ? color.text.disabled : onDark && !selected ? color.text.onBrand : color.text.primary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function onLightLook(selected: boolean, focused: boolean, pressed: boolean) {
  return {
    borderWidth: focused ? size.focusRing.width : selected ? borderWidth.strong : borderWidth.default,
    borderColor: focused ? color.focus.ring : selected ? color.border.selected : color.border.strong,
    backgroundColor: selected ? color.bg.selected : pressed ? color.bg.surfacePressed : color.bg.surface,
  };
}

function onDarkLook(selected: boolean, focused: boolean, pressed: boolean) {
  return {
    borderWidth: focused ? size.focusRing.width : borderWidth.default,
    borderColor: focused ? color.focus.ringInverse : color.border.inverse,
    backgroundColor: selected ? color.bg.surface : pressed ? color.bg.brand : 'transparent',
  };
}
