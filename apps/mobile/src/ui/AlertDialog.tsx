import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, ScrollView, Text, View } from 'react-native';
import { color, elevation, radius, space, text } from './theme';

export interface AlertDialogProps {
  title: string;
  /** Body of the dialog (texts). */
  children: ReactNode;
  /** Buttons, the main one first (stacked for one hand). */
  actions: ReactNode;
  /** System "back" cancels the dialog. */
  onCancel: () => void;
  testID?: string;
}

/**
 * Alert dialog (styleguide § 3.13): title `text.heading-3`, body, actions; scrim `color.bg.scrim`. Rendered INSIDE the window of the
 * Activity on purpose — React Native's Modal opens its own Android window, which does not inherit `FLAG_SECURE` (security W4). The
 * reader focus moves to the title; "back" cancels.
 */
export function AlertDialog({ title, children, actions, onCancel, testID }: AlertDialogProps) {
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (titleRef.current !== null) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  }, []);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [onCancel]);
  return (
    <View
      testID={testID}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: color.bg.scrim,
        justifyContent: 'center',
        padding: space.inset.md,
      }}
    >
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: color.bg.surface,
          borderRadius: radius.dialog,
          padding: space.inset.md,
          maxHeight: '100%',
          ...elevation.dialog,
        }}
      >
        <ScrollView contentContainerStyle={{ rowGap: space.stack.md }}>
          <Text ref={titleRef} accessibilityRole="header" style={{ ...text.heading3, color: color.text.primary }}>
            {title}
          </Text>
          {children}
          <View style={{ rowGap: space.stack.sm }}>{actions}</View>
        </ScrollView>
      </View>
    </View>
  );
}
