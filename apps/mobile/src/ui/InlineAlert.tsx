import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { CircleAlert, WifiOff } from './icons';
import { borderWidth, color, radius, space, text } from './theme';

export type AlertTone = 'error' | 'info';

export interface InlineAlertProps {
  tone: AlertTone;
  title?: string;
  body: string;
  /** Secondary line, e.g. "Kod: …" (styleguide § 6.4). */
  code?: string;
  action?: ReactNode;
  testID?: string;
}

/**
 * Alert / banner (styleguide § 3.19): tone colours, tone icon, a left bar. Only errors are `role="alert"`; other tones are polite
 * live regions (announced once when they appear, no spam).
 */
export function InlineAlert({ tone, title, body, code, action, testID }: InlineAlertProps) {
  const tokens = color.feedback[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        columnGap: space.inline.md,
        padding: space.inset.md,
        backgroundColor: tokens.bg,
        borderLeftWidth: borderWidth.indicator,
        borderLeftColor: tokens.border,
        borderRadius: radius.control,
      }}
    >
      <Icon icon={tone === 'error' ? CircleAlert : WifiOff} color={tokens.icon} />
      <View style={{ flex: 1, rowGap: space.stack.xs }}>
        {title === undefined ? null : <Text style={{ ...text.labelLg, color: tokens.text }}>{title}</Text>}
        <Text style={{ ...text.body, color: color.text.primary }}>{body}</Text>
        {code === undefined ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{code}</Text>}
        {action}
      </View>
    </View>
  );
}
