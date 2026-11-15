import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface SwitchRowProps {
  /** The visible label, on the right of the switch ("Filmy tylko przez Wi-Fi"). */
  label: string;
  /** The explanation under the label; also the accessibility hint of the switch (styleguide § 3.4). Depends on the state, so the screen passes the one for `value`. */
  description?: string;
  value: boolean;
  /** The new value; the change is immediate, with no dialog and no "Zapisz". */
  onValueChange: (next: boolean) => void;
  /** Blocked until the value is stored (styleguide § 3.4: "blokada do czasu zapisu"). */
  disabled?: boolean;
  testID?: string;
  descriptionTestID?: string;
}

/**
 * Switch (styleguide § 3.4): a row of at least `size.touch-target.min` with a pill track (`radius.pill`, `color.control.checked` with the thumb
 * `color.control.on-checked` when on) and the label on the right; the whole row is the target. The state is carried by the role `switch`, the accessibility
 * state `checked` AND the position of the thumb - never by the colour alone. Focus: the ring `color.focus.ring`.
 */
export function SwitchRow({ label, description, value, onValueChange, disabled = false, testID, descriptionTestID }: SwitchRowProps) {
  const [focused, setFocused] = useState(false);
  const track = { width: size.icon['2xl'], height: size.icon.lg };
  const thumb = size.icon.lg - 2 * borderWidth.strong;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        onValueChange(!value);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      testID={testID}
      style={{
        minHeight: size.touchTarget.min,
        flexDirection: 'row',
        alignItems: 'flex-start',
        columnGap: space.inline.md,
        paddingVertical: space.inset.sm,
        borderRadius: radius.control,
        borderWidth: focused ? size.focusRing.width : 0,
        borderColor: color.focus.ring,
      }}
    >
      <View
        style={{
          ...track,
          borderRadius: radius.pill,
          borderWidth: borderWidth.strong,
          borderColor: disabled ? color.control.borderDisabled : value ? color.control.checked : color.border.strong,
          backgroundColor: value ? color.control.checked : color.control.bg,
          justifyContent: 'center',
          alignItems: value ? 'flex-end' : 'flex-start',
        }}
      >
        <View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: radius.pill,
            backgroundColor: value ? color.control.onChecked : disabled ? color.control.borderDisabled : color.border.strong,
          }}
        />
      </View>
      <View style={{ flex: 1, rowGap: space.stack.xs }}>
        <Text style={{ ...text.labelLg, color: disabled ? color.text.disabled : color.text.primary }}>{label}</Text>
        {description === undefined ? null : (
          <Text style={{ ...text.bodySm, color: color.text.secondary }} testID={descriptionTestID}>
            {description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
