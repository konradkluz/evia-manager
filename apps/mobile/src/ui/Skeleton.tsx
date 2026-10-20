import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { color, motion, radius, space } from './theme';

/** motion.easing.linear */
const linear = (value: number): number => value;

/** One block of the skeleton: `color.bg.skeleton` with a pulsing `color.bg.skeleton-highlight` layer (native-driven opacity). */
function Block({ height, widthPercent, pulse }: { height: number; widthPercent: number; pulse: Animated.Value }) {
  return (
    <View
      style={{
        height,
        width: `${String(widthPercent)}%`,
        borderRadius: radius.control,
        backgroundColor: color.bg.skeleton,
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ flex: 1, backgroundColor: color.bg.skeletonHighlight, opacity: pulse }} />
    </View>
  );
}

/**
 * Loading skeleton (styleguide § 3.16): text lines and a card, `aria-busy`; no spinner. The pulse stops when the system asks to
 * reduce motion.
 */
export function Skeleton({ accessibilityLabel, testID }: { accessibilityLabel: string; testID?: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: motion.duration.skeleton / 2, easing: linear, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: motion.duration.skeleton / 2, easing: linear, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      testID={testID}
      style={{ padding: space.stack.md, rowGap: space.stack.md }}
    >
      <Block height={space.stack.lg} widthPercent={60} pulse={pulse} />
      <Block height={space.stack.md} widthPercent={90} pulse={pulse} />
      <Block height={space.stack.md} widthPercent={75} pulse={pulse} />
      <Block height={space.stack['2xl'] * 3} widthPercent={100} pulse={pulse} />
    </View>
  );
}
