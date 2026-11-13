import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { Search, X } from './icons';
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

export interface SearchOptions {
  /** Accessible name of the clear button ("Wyczyść wyszukiwanie"). */
  readonly clearLabel: string;
  readonly onClear: () => void;
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
  /**
   * Search variant (styleguide § 3.2, § 3.7): a search icon, a clear button (`size.touch-target.min`) and the keyboard that does not
   * learn what is typed as far as the standard properties go - autocorrect, spell check, autofill and suggestions off (EVM-103 AC6).
   */
  search?: SearchOptions;
  /** Maximum length of the value (protects the work budget of a search). */
  maxLength?: number;
  placeholder?: string;
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
  search,
  maxLength,
  placeholder,
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
  const priv = search !== undefined;
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
          {search === undefined ? null : (
            <View style={{ paddingLeft: space.inset.md }}>
              <Icon icon={Search} color={color.icon.secondary} />
            </View>
          )}
          <TextInput
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ disabled: !editable }}
            value={value}
            onChangeText={onChangeText}
            editable={editable}
            secureTextEntry={masked}
            keyboardType={keyboard}
            autoComplete={priv ? 'off' : autoComplete}
            textContentType={priv ? 'none' : textContentType}
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="none"
            importantForAutofill={priv ? 'no' : 'yes'}
            maxLength={maxLength}
            placeholder={placeholder}
            returnKeyType={priv ? 'search' : returnKeyType}
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
          {search === undefined || value === '' ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={search.clearLabel}
              onPress={search.onClear}
              testID={testID === undefined ? undefined : `${testID}-clear`}
              style={({ pressed }) => ({
                minHeight: size.touchTarget.min,
                minWidth: size.touchTarget.min,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? color.action.tertiary.bgPressed : 'transparent',
                borderRadius: radius.control,
              })}
            >
              <Icon icon={X} color={color.icon.primary} />
            </Pressable>
          )}
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
