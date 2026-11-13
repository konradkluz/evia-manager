import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { color, elevation, radius, size, space, text } from './theme';

/** Minimum time on the screen (styleguide § 3.14). */
export const TOAST_MS = 6000;

export interface ToastProps {
  /** A fixed text, at most two lines; never data of a user (it may be read by the screen reader and seen by others). */
  message: string;
  /** Called when the time is over. */
  onDismiss: () => void;
  testID?: string;
}

/**
 * Toast (styleguide § 3.14): `color.bg.inverse` with `color.text.inverse`, `radius.control`, `elevation.toast`, at most `size.toast.maxWidth`;
 * a polite live region (announced once). It disappears after six seconds. Errors are never a toast (an alert in place instead).
 * Hosted by the shell above the navigation, so it outlives the screen that raised it.
 */
export function Toast({ message, onDismiss, testID }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [message, onDismiss]);
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: space.inset.md, alignItems: 'center', paddingHorizontal: space.inset.md }}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={testID}
        style={{
          maxWidth: size.toast.maxWidth,
          backgroundColor: color.bg.inverse,
          borderRadius: radius.control,
          paddingHorizontal: space.inset.md,
          paddingVertical: space.inset.sm,
          ...elevation.toast,
        }}
      >
        <Text numberOfLines={2} style={{ ...text.body, color: color.text.inverse }}>
          {message}
        </Text>
      </View>
    </View>
  );
}
