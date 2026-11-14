import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface SelectableCardProps {
  /** The name of the option. */
  title: string;
  /** The line under it ("3 pozycje · 1 transza"). */
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** The accessible name with the description ("Dom - sam montaż, 3 pozycje, 1 transza"). */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Card of choice (styleguide § 3.22, mobile): a radio, the title and the description; the whole card is the label of the radio and the
 * target of the touch (at least `size.touch-target.min`). The chosen card has the outline `color.border.selected` of
 * `border-width.indicator`, the checked radio and the background `color.bg.selected` together - the state is never the colour alone.
 * Focus: the ring `color.focus.ring` around the whole card. The group (`radiogroup`, legend) is the screen's.
 */
export function SelectableCard({ title, description, selected, onPress, accessibilityLabel, testID }: SelectableCardProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected }}
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
        columnGap: space.inline.md,
        minHeight: size.touchTarget.min,
        padding: space.inset.md,
        borderRadius: radius.card,
        borderWidth: focused ? size.focusRing.width : selected ? borderWidth.indicator : borderWidth.default,
        borderColor: focused ? color.focus.ring : selected ? color.border.selected : color.border.default,
        backgroundColor: selected ? color.bg.selected : pressed ? color.bg.surfacePressed : color.bg.surface,
      })}
    >
      <View
        style={{
          width: space.inset.lg,
          height: space.inset.lg,
          borderRadius: radius.pill,
          borderWidth: borderWidth.strong,
          borderColor: selected ? color.control.checked : color.border.strong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View
            style={{ width: space.inset.sm, height: space.inset.sm, borderRadius: radius.pill, backgroundColor: color.control.checked }}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, rowGap: space.stack.xs }}>
        <Text style={{ ...text.labelLg, color: color.text.primary }}>{title}</Text>
        {description === undefined ? null : <Text style={{ ...text.body, color: color.text.secondary }}>{description}</Text>}
      </View>
    </Pressable>
  );
}
