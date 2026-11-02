import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, type ButtonVariant } from './Button';
import { Icon } from './Icon';
import { ChevronDown, ChevronUp, CircleAlert } from './icons';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface AttentionAction {
  key: string;
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

export interface AttentionCardProps {
  /** "Wpis", "Nowe zlecenie · Dom - sam montaż": the type, never more in the hidden-data mode. */
  title: string;
  /** "Dodano w telefonie 02.11.2026, 9:12 · 3 dni temu". */
  age: string;
  /** The reason in plain words (flow 16); the technical code never stands here. */
  reason: string;
  /** "Czeka z nim 4 elementy" (a quick work order with its dependents). */
  group?: string;
  /** Text of the entry (up to a few lines); absent in the hidden-data mode. */
  body?: string | null;
  /** Texts of the "technical details" disclosure and its lines (code and date, never a server message). */
  detailsLabel: string;
  details: readonly string[];
  /** The accessible name of the whole element, e.g. "Wpis, wymaga uwagi: zlecenie usunięte albo brak dostępu". */
  accessibilityLabel: string;
  actions: readonly AttentionAction[];
  extra?: ReactNode;
  testID?: string;
}

/**
 * An element that needs attention (flow 16, M-07): type, age, reason in plain words, the entry's text, a disclosure with the technical
 * details and the visible action buttons - the order of the caller is the order of importance and the last one is "Usuń z telefonu".
 * Texts and callbacks come in as props (no i18n here).
 */
export function AttentionCard({
  title,
  age,
  reason,
  group,
  body,
  detailsLabel,
  details,
  accessibilityLabel,
  actions,
  extra,
  testID,
}: AttentionCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityLabel={accessibilityLabel}
      style={{
        rowGap: space.stack.sm,
        padding: space.inset.md,
        backgroundColor: color.bg.surface,
        borderRadius: radius.control,
        borderWidth: borderWidth.default,
        borderColor: color.border.subtle,
        borderLeftWidth: borderWidth.indicator,
        borderLeftColor: color.feedback.error.border,
      }}
    >
      <View
        style={{ flexDirection: 'row', columnGap: space.inline.md, alignItems: 'center' }}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        <Icon icon={CircleAlert} color={color.feedback.error.icon} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...text.labelLg, color: color.text.primary }}>{title}</Text>
          <Text style={{ ...text.bodySm, color: color.text.secondary }}>{age}</Text>
        </View>
      </View>
      <Text style={{ ...text.body, color: color.text.primary }}>{reason}</Text>
      {group === undefined ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{group}</Text>}
      {body === undefined || body === null ? null : (
        <Text numberOfLines={5} style={{ ...text.body, color: color.text.primary }}>
          {body}
        </Text>
      )}
      {extra}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={detailsLabel}
        onPress={() => {
          setOpen((value) => !value);
        }}
        style={{ minHeight: size.touchTarget.min, flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }}
        testID={testID === undefined ? undefined : `${testID}-details-toggle`}
      >
        <Text style={{ ...text.label, color: color.text.link }}>{detailsLabel}</Text>
        <Icon icon={open ? ChevronUp : ChevronDown} color={color.text.link} iconSize="md" />
      </Pressable>
      {open ? (
        <View style={{ rowGap: space.stack.xs }} testID={testID === undefined ? undefined : `${testID}-details`}>
          {details.map((line) => (
            <Text key={line} selectable={false} style={{ ...text.bodySm, color: color.text.secondary }}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={{ rowGap: space.stack.sm }}>
        {actions.map((action) => (
          <Button
            key={action.key}
            label={action.label}
            onPress={action.onPress}
            variant={action.variant ?? 'tertiary'}
            disabled={action.disabled === true}
            testID={testID === undefined ? undefined : `${testID}-${action.key}`}
          />
        ))}
      </View>
    </View>
  );
}
