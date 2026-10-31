import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { borderWidth, color, radius, size, space, text } from './theme';

type InputProps = ComponentProps<typeof TextInput>;

export interface SecureToggle {
  /** The value is visible now. */
  readonly shown: boolean;
  readonly onToggle: () => void;
  /** Visible labels of the toggle ("Pokaż" / "Ukryj"). */
  readonly showLabel: string;
  readonly hideLabel: string;
  /** Accessible names with the object ("Pokaż hasło", "Pokaż kod"). */
  readonly showName: string;
  readonly hideName: string;
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  hint?: string;
  invalid?: boolean;
  /** Masked field with "Pokaż" / "Ukryj" in the suffix (styleguide § 3.2, § 3.2.1). */
  secure?: SecureToggle;
  /** One-time code: `text.numeric-lg`, number pad (styleguide § 3.2.1). */
  numeric?: boolean;
  /** The field sits on `color.bg.brand` (M-01): label and hint in `color.text.on-brand`, the inverse focus ring. */
  inverse?: boolean;
  editable?: boolean;
  keyboardType?: InputProps['keyboardType'];
  autoComplete?: InputProps['autoComplete'];
  textContentType?: InputProps['textContentType'];
  returnKeyType?: InputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  testID?: string;
}

/**
 * Text field (styleguide § 3.2 and § 3.2.1): the label is always visible and is the accessible name; a masked value has a toggle with
 * the state of a switch. Secrets are never learnt by the keyboard (security W6): autocorrect, suggestions, spell check and
 * capitalisation are off, and a shown password uses the Android `visible-password` keyboard. Paste and password managers stay allowed.
 */
export function TextField({
  label,
  value,
  onChangeText,
  hint,
  invalid = false,
  secure,
  numeric = false,
  inverse = false,
  editable = true,
  keyboardType,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  testID,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const masked = secure !== undefined && !secure.shown;
  const keyboard = numeric
    ? 'number-pad'
    : secure?.shown === true
      ? Platform.OS === 'android'
        ? 'visible-password'
        : 'ascii-capable'
      : keyboardType;
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Text style={{ ...text.labelLg, color: inverse ? color.text.onBrand : color.text.primary }}>{label}</Text>
      <View
        style={{
          padding: focused ? 0 : size.focusRing.width,
          borderWidth: focused ? size.focusRing.width : 0,
          borderColor: inverse ? color.focus.ringInverse : color.focus.ring,
          borderRadius: radius.control + size.focusRing.offset,
        }}
      >
        <View
          testID={testID === undefined ? undefined : `${testID}-frame`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: size.control.height.mobile.md,
            borderRadius: radius.control,
            backgroundColor: editable ? color.control.bg : color.control.bgDisabled,
            borderWidth: focused || invalid ? borderWidth.strong : borderWidth.default,
            borderColor: invalid ? color.border.error : focused ? color.border.selected : color.border.strong,
          }}
        >
          <TextInput
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ disabled: !editable }}
            value={value}
            onChangeText={onChangeText}
            editable={editable}
            secureTextEntry={masked}
            keyboardType={keyboard}
            autoComplete={autoComplete}
            textContentType={textContentType}
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="none"
            importantForAutofill="yes"
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
            }}
            placeholderTextColor={color.control.placeholder}
            testID={testID}
            style={{
              flex: 1,
              ...(numeric ? text.numericLg : text.body),
              color: editable ? color.text.primary : color.text.disabled,
              paddingHorizontal: space.inset.md,
              minHeight: size.control.height.mobile.md,
            }}
          />
          {secure === undefined ? null : (
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={secure.shown ? secure.hideName : secure.showName}
              accessibilityState={{ checked: secure.shown }}
              onPress={secure.onToggle}
              testID={testID === undefined ? undefined : `${testID}-toggle`}
              style={({ pressed }) => ({
                minHeight: size.touchTarget.min,
                minWidth: size.touchTarget.min,
                paddingHorizontal: space.inset.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? color.action.tertiary.bgPressed : 'transparent',
                borderRadius: radius.control,
              })}
            >
              <Text style={{ ...text.button, color: color.action.tertiary.text }}>
                {secure.shown ? secure.hideLabel : secure.showLabel}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      {hint === undefined ? null : (
        <Text style={{ ...text.bodySm, color: inverse ? color.text.onBrand : color.text.tertiary }}>{hint}</Text>
      )}
    </View>
  );
}
