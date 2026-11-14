import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, size, space, text } from './theme';

/**
 * Top bar (styleguide § 3.18): `color.bg.brand-strong`, the title as a heading, the sync indicator on the right and, on a detail screen, the back action on the left. Everything on the bar
 * uses the inverse focus ring (`color.focus.ring-inverse`) — the default ring has only 1.74:1 here.
 */
export function AppBar({ title, right, left }: { title: string; right?: ReactNode; left?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.bg.brandStrong,
        paddingTop: insets.top,
        paddingHorizontal: space.inset.md,
        minHeight: size.appBar.height.mobile + insets.top,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: space.inline.md,
      }}
    >
      {left}
      <Text accessibilityRole="header" style={{ ...text.heading3, color: color.text.onBrand, flexShrink: 1, flex: 1 }}>
        {title}
      </Text>
      {right}
    </View>
  );
}
