import type { LucideIcon } from 'lucide-react-native';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { color, space, text } from './theme';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional action (primary or tertiary Button); the "no action" variant of the skeleton has none. */
  action?: ReactNode;
  /** Extra content under the description (e.g. the versions line of the update screen). */
  children?: ReactNode;
  /** The blocking variant (styleguide § 3.15.1) uses the heading-2 title; `titleRef` lets the screen move the reader focus to it. */
  blocking?: boolean;
  titleRef?: Ref<ComponentRef<typeof Text>>;
  testID?: string;
}

/** Empty state (styleguide § 3.15): icon, title, description, optional action; centred, around it `space.stack.2xl`. */
export function EmptyState({ icon, title, description, action, children, blocking = false, titleRef, testID }: EmptyStateProps) {
  return (
    <View
      testID={testID}
      style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.stack['2xl'], rowGap: space.stack.md }}
    >
      <Icon icon={icon} color={color.icon.secondary} iconSize="2xl" />
      <Text
        ref={titleRef}
        accessibilityRole="header"
        style={{ ...(blocking ? text.heading2 : text.heading3), color: color.text.primary, textAlign: 'center' }}
      >
        {title}
      </Text>
      {description === undefined ? null : (
        <Text style={{ ...text.body, color: color.text.secondary, textAlign: 'center' }}>{description}</Text>
      )}
      {children}
      {action}
    </View>
  );
}
