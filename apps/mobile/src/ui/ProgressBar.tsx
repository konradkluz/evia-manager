import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { color, motion, radius, size } from './theme';

export type ProgressTone = 'progress' | 'done' | 'error';

export interface ProgressBarProps {
  /** 0..1, or `null` when the total is not known (the server announces none): an indeterminate bar. */
  value: number | null;
  /** The spoken name and value, e.g. "Pobieramy zlecenia, pobrano 120". The bar itself is decoration (styleguide § 3.19). */
  accessibilityLabel: string;
  tone?: ProgressTone;
  testID?: string;
}

const FILL = { progress: color.sync.progress.fill, done: color.sync.progress.fillDone, error: color.sync.progress.fillError } as const;

/**
 * Progress bar (styleguide § 3.19; tokens `size.progress-bar.height`, `color.sync.progress.*`). The information is in the text next to
 * it; an unknown total is shown as a bar that slides, or as a fixed segment when the system asks to reduce motion.
 */
export function ProgressBar({ value, accessibilityLabel, tone = 'progress', testID }: ProgressBarProps) {
  const slide = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => undefined);
  }, []);
  const indeterminate = value === null;
  useEffect(() => {
    if (!indeterminate || reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(slide, { toValue: 1, duration: motion.duration.skeleton, easing: (t) => t, useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [indeterminate, reduceMotion, slide]);
  const segment = width * 0.4;
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={indeterminate ? {} : { min: 0, max: 100, now: Math.round(Math.min(1, Math.max(0, value)) * 100) }}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      style={{ height: size.progressBar.height, borderRadius: radius.pill, backgroundColor: color.sync.progress.track, overflow: 'hidden' }}
    >
      {indeterminate ? (
        <Animated.View
          style={{
            height: '100%',
            width: segment,
            borderRadius: radius.pill,
            backgroundColor: FILL[tone],
            transform: [{ translateX: reduceMotion ? 0 : slide.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
          }}
        />
      ) : (
        <View
          style={{ height: '100%', width: `${String(Math.round(Math.min(1, Math.max(0, value)) * 100))}%`, backgroundColor: FILL[tone] }}
        />
      )}
    </View>
  );
}
