import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NARROW_WIDTH_DP, useFontScaleTier } from './fontScale';
import { Icon } from './Icon';
import { color, elevation, radius, size, space, text } from './theme';

export interface BottomNavItem {
  key: string;
  label: string;
  /** A deliberate shortening ( "Zlecenia" for "Moje zlecenia"), shown only at a large font on a narrow screen; the accessible name stays the full `label`. */
  shortLabel?: string;
  icon: LucideIcon;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Bottom navigation (styleguide § 3.18): icon plus an always visible label; the active item is a capsule behind the icon
 * (`color.nav.indicator`, 6.74:1) and a heavier label — never only a tint. Each item is at least 48 dp.
 * EVM-151: a label wraps on spaces (up to two lines, never cut) and the items have an equal height (`minHeight`, the row stretches them); at a large font
 * on a narrow screen an item may show its `shortLabel` instead of the full one.
 */
export function BottomNav({ items, accessibilityLabel }: { items: BottomNavItem[]; accessibilityLabel: string }) {
  const insets = useSafeAreaInsets();
  const tier = useFontScaleTier();
  const { width } = useWindowDimensions();
  const short = tier === 'large' && width <= NARROW_WIDTH_DP;
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: color.bg.surface,
        minHeight: size.bottomNav.height + insets.bottom,
        paddingBottom: insets.bottom,
        ...elevation.bottomBar,
      }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="tab"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: item.selected }}
          onPress={item.onPress}
          testID={item.testID}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: size.touchTarget.min,
            alignItems: 'center',
            justifyContent: 'center',
            rowGap: space.stack.xs,
            paddingVertical: space.inset.xs,
            paddingHorizontal: space.inset.xs,
            backgroundColor: pressed ? color.bg.surfacePressed : color.bg.surface,
          })}
        >
          <View
            style={{
              width: size.bottomNav.indicator.width,
              height: size.bottomNav.indicator.height,
              borderRadius: radius.pill,
              // without it Android keeps square corners of a background that changes while the view is alive
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: item.selected ? color.nav.indicator : 'transparent',
            }}
          >
            <Icon icon={item.icon} color={item.selected ? color.nav.onIndicator : color.nav.icon} />
          </View>
          <Text
            style={{
              ...text.label,
              color: item.selected ? color.nav.labelActive : color.nav.label,
              fontWeight: item.selected ? '600' : '500',
              textAlign: 'center',
            }}
          >
            {short && item.shortLabel !== undefined ? item.shortLabel : item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
