import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { ChevronDown, ChevronUp } from './icons';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface DisclosureProps {
  title: string;
  /** The line under the title ("Wersja 1.0 · od 01.11.2026"). */
  caption?: string;
  /** The accessible name of the header with the state ("Klauzula dla klientów, zwinięta, wersja 1.0"); it must start with the title (WCAG 2.5.3). */
  accessibilityLabel: string;
  /** Expanded at the start (the entry of M-11 "Prywatność" opens its section). */
  defaultExpanded?: boolean;
  children: ReactNode;
  testID?: string;
}

/**
 * Disclosure (styleguide § 3.21, mobile): a header of at least `size.touch-target.min` that expands and collapses the content below it;
 * the state is carried by the chevron (down = collapsed, up = expanded) AND by the accessibility state (`expanded`), never by the colour alone. Focus: the ring
 * `color.focus.ring`. The content stays mounted only while it is expanded (long legal texts are not laid out while collapsed).
 */
export function Disclosure({ title, caption, accessibilityLabel, defaultExpanded = false, children, testID }: DisclosureProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        borderWidth: borderWidth.default,
        borderColor: color.border.default,
        borderRadius: radius.card,
        backgroundColor: color.bg.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded((value) => !value);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        testID={testID}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: space.inline.md,
          minHeight: size.touchTarget.min,
          padding: space.inset.md,
          borderWidth: focused ? size.focusRing.width : 0,
          borderColor: color.focus.ring,
          backgroundColor: pressed ? color.bg.surfacePressed : color.bg.surface,
        })}
      >
        <View style={{ flex: 1, rowGap: space.stack.xs }}>
          <Text style={{ ...text.heading4, color: color.text.primary }}>{title}</Text>
          {caption === undefined ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{caption}</Text>}
        </View>
        <Icon icon={expanded ? ChevronUp : ChevronDown} color={color.text.secondary} />
      </Pressable>
      {expanded ? (
        <View
          style={{
            padding: space.inset.md,
            rowGap: space.stack.sm,
            borderTopWidth: borderWidth.default,
            borderTopColor: color.border.subtle,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
