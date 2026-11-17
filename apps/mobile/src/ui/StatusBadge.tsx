import type { LucideIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { borderWidth, radius, size, space, text } from './theme';

export interface BadgeTone {
  readonly bg: string;
  readonly text: string;
  readonly icon: string;
  /** An outline (styleguide § 4.4: the computed mark "Wizja lokalna" has `feedback.info.border`); the statuses have none. */
  readonly border?: string;
}

export interface StatusBadgeProps {
  icon: LucideIcon;
  label: string;
  /** Colours of the group (`color.status.*`, `color.sync.*`): the caller maps the model code to the token (styleguide § 4.4). */
  tone: BadgeTone;
  testID?: string;
}

/** Status badge (styleguide § 3.9): icon and label on the tone background, `radius.pill`; the label is never shortened. */
export function StatusBadge({ icon, label, tone, testID }: StatusBadgeProps) {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        columnGap: space.inline.xs,
        minHeight: size.badge.height,
        paddingHorizontal: space.inset.sm,
        paddingVertical: space.inset.xs,
        borderRadius: radius.pill,
        backgroundColor: tone.bg,
        ...(tone.border === undefined ? {} : { borderWidth: borderWidth.default, borderColor: tone.border }),
      }}
    >
      <Icon icon={icon} color={tone.icon} iconSize="sm" />
      <Text style={{ ...text.label, color: tone.text }}>{label}</Text>
    </View>
  );
}
