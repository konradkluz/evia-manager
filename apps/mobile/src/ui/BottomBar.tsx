import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, elevation, space } from './theme';

/** Bottom bar of a screen with its main action (styleguide § 3.1 mobile, § 3.15.1): it stays visible while the content scrolls. */
export function BottomBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.bg.surface,
        paddingHorizontal: space.inset.md,
        paddingTop: space.inset.sm,
        paddingBottom: space.inset.sm + insets.bottom,
        rowGap: space.stack.xs,
        ...elevation.bottomBar,
      }}
    >
      {children}
    </View>
  );
}
