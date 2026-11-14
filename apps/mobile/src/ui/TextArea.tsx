import { useState } from 'react';
import type { ComponentRef, Ref } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { CircleAlert } from './icons';
import { borderWidth, color, radius, size, space, text } from './theme';

export interface TextAreaProps {
  /** Always visible; it is the accessible name (the placeholder never replaces it). */
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Fixed help under the field (`color.text.tertiary`). */
  hint?: string;
  /** The error under the field (`color.text.error`, with the icon); the field gets the strong error border. */
  error?: string;
  /** For the focus after a failed validation. */
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
  editable?: boolean;
  testID?: string;
}

/** The field grows to six lines, then it scrolls (styleguide § 3.2). */
const MIN_LINES = 4;
const MAX_LINES = 6;

/**
 * Multi-line text field (styleguide § 3.2, TextArea) for long texts: entries and comments (EVM-105).
 * - The keyboard keeps autocorrect and spell check ON, on purpose (decision of the owner of 2026-11-13: long texts and dictation);
 *   the fields of a name, phone and address (TextField) keep them off. Autofill is off everywhere: `importantForAutofill="no"`,
 *   `autoComplete="off"`, `textContentType="none"`.
 * - No `maxLength`: the limit is checked on save and told to the user (nothing is cut silently).
 * - No `dataDetectorType`: a phone number typed into the text is never an active link.
 */
export function TextArea({ label, value, onChangeText, hint, error, inputRef, editable = true, testID }: TextAreaProps) {
  const [focused, setFocused] = useState(false);
  const invalid = error !== undefined;
  const line = text.body.lineHeight;
  return (
    <View style={{ rowGap: space.stack.xs }}>
      <Text style={{ ...text.labelLg, color: color.text.primary }}>{label}</Text>
      <View
        style={{
          padding: focused ? 0 : size.focusRing.width,
          borderWidth: focused ? size.focusRing.width : 0,
          borderColor: color.focus.ring,
          borderRadius: radius.control + size.focusRing.offset,
        }}
      >
        <View
          style={{
            borderRadius: radius.control,
            backgroundColor: editable ? color.control.bg : color.control.bgDisabled,
            borderWidth: focused || invalid ? borderWidth.strong : borderWidth.default,
            borderColor: invalid ? color.border.error : focused ? color.border.selected : color.border.strong,
          }}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel={label}
            accessibilityHint={hint}
            accessibilityState={{ disabled: !editable }}
            value={value}
            onChangeText={onChangeText}
            editable={editable}
            multiline
            textAlignVertical="top"
            autoCorrect
            spellCheck
            autoCapitalize="sentences"
            autoComplete="off"
            textContentType="none"
            importantForAutofill="no"
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
            }}
            placeholderTextColor={color.control.placeholder}
            testID={testID}
            style={{
              ...text.body,
              color: editable ? color.text.primary : color.text.disabled,
              paddingHorizontal: space.inset.md,
              paddingVertical: space.inset.sm,
              minHeight: line * MIN_LINES + space.inset.sm * 2,
              maxHeight: line * MAX_LINES + space.inset.sm * 2,
            }}
          />
        </View>
      </View>
      {hint === undefined ? null : <Text style={{ ...text.bodySm, color: color.text.tertiary }}>{hint}</Text>}
      {error === undefined ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }} accessibilityLiveRegion="polite">
          <Icon icon={CircleAlert} color={color.text.error} />
          <Text
            style={{ ...text.bodySm, color: color.text.error, flexShrink: 1 }}
            testID={testID === undefined ? undefined : `${testID}-error`}
          >
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}
