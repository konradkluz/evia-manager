import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { CloudCheck, WifiOff } from './icons';
import { borderWidth, color, radius, size, space, text } from './theme';

export type SyncState = 'online' | 'offline';

export interface SyncIndicatorProps {
  state: SyncState;
  /** Visible text of the capsule ("Połączono", "Offline"). */
  label: string;
  /** Full accessible name, e.g. "Offline. Otwórz kolejkę". */
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

/**
 * Global sync indicator (styleguide § 5.4): a capsule on its own background, never a bare icon on the app bar. The offline capsule
 * has a `color.border.inverse` outline (its background has only 1.58:1 to the bar). The touch area is larger than the capsule.
 */
export function SyncIndicator({ state, label, accessibilityLabel, onPress, testID }: SyncIndicatorProps) {
  const [focused, setFocused] = useState(false);
  const tokens = state === 'offline' ? color.sync.offline : color.sync.done;
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
      style={{
        minHeight: size.touchTarget.min,
        minWidth: size.touchTarget.min,
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: size.focusRing.width,
        borderColor: focused ? color.focus.ringInverse : 'transparent',
        flexShrink: 0,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: space.inline.sm,
          backgroundColor: tokens.bg,
          borderRadius: radius.pill,
          paddingVertical: space.inset.xs,
          paddingHorizontal: space.inset.sm,
          borderWidth: state === 'offline' ? borderWidth.strong : 0,
          borderColor: color.border.inverse,
        }}
      >
        <Icon icon={state === 'offline' ? WifiOff : CloudCheck} color={tokens.icon} iconSize="md" />
        <Text numberOfLines={1} style={{ ...text.label, color: tokens.text }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
