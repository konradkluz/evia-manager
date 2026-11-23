import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFontScaleTier } from './fontScale';
import { color, size, space, text } from './theme';

/** The title never goes below this width in the one-row layouts; when it would, the bar is large (EVM-151). */
const TITLE_MIN_WIDTH_DP = 96;

/**
 * Top bar (styleguide § 3.18): `color.bg.brand-strong`, the title as a heading, the sync indicator on the right and, on a detail screen, the back action on the left. Everything on the bar
 * uses the inverse focus ring (`color.focus.ring-inverse`) — the default ring has only 1.74:1 here.
 * EVM-151: the bar grows with the content (`minHeight`) and the title wraps on spaces - never cut, never shrunk. At a normal or medium font one row; at a large font (above 130%, above
 * 100% on a narrow screen) two rows: the back action and the sync capsule on the first, the title on the whole width of the second.
 */
export function AppBar({ title, right, left }: { title: string; right?: ReactNode; left?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const tier = useFontScaleTier();
  const large = tier === 'large';
  const titleText = (
    <Text
      accessibilityRole="header"
      style={{
        ...text.heading3,
        color: color.text.onBrand,
        ...(large ? { alignSelf: 'stretch' as const } : { flexShrink: 1, flex: 1 }),
        ...(tier === 'medium' ? { minWidth: TITLE_MIN_WIDTH_DP } : {}),
      }}
    >
      {title}
    </Text>
  );
  return (
    <View
      testID="app-bar"
      style={{
        backgroundColor: color.bg.brandStrong,
        paddingTop: insets.top,
        paddingHorizontal: space.inset.md,
        minHeight: size.appBar.height.mobile + insets.top,
        flexDirection: large ? 'column' : 'row',
        alignItems: large ? 'stretch' : 'center',
        justifyContent: 'space-between',
        columnGap: space.inline.md,
        ...(large ? { paddingBottom: space.inset.sm } : {}),
      }}
    >
      {large ? (
        <>
          {left !== undefined || right !== undefined ? (
            <View
              testID="app-bar-actions"
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', columnGap: space.inline.md }}
            >
              {left}
              <View style={{ flex: 1 }} />
              {right}
            </View>
          ) : null}
          {titleText}
        </>
      ) : (
        <>
          {left}
          {titleText}
          {right}
        </>
      )}
    </View>
  );
}
