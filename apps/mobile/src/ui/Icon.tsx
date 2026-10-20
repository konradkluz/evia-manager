import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { size } from './theme';

export type IconSize = 'md' | 'lg' | '2xl';

/** Decorative Lucide icon (styleguide § 2.10): hidden from screen readers — the state is always carried by a text as well. */
export function Icon({ icon: Glyph, color, iconSize = 'lg' }: { icon: LucideIcon; color: string; iconSize?: IconSize }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Glyph color={color} size={size.icon[iconSize]} strokeWidth={size.icon.stroke} />
    </View>
  );
}
