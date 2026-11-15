import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from './theme';

export interface CameraPanelProps {
  /** The accessible name of the group of chips ("Kategoria"); the chips are a radio group. */
  chipsLabel: string;
  /** The chips of the categories (`FilterChip` with `onDark`), scrolled sideways. */
  chips: ReactNode;
  /** A text or a banner above the chips (the hint, the warning); optional. */
  notice?: ReactNode;
  /** The left, the middle and the right cell of the control row: the counter, the shutter and "Gotowe". */
  counter: ReactNode;
  shutter: ReactNode;
  done: ReactNode;
}

/**
 * The bottom panel of the camera (styleguide § 3.24): `color.bg.brand-strong`, the notice, the chips (scrolled sideways, `space.inline.sm` apart),
 * and the row of the counter, the shutter and "Gotowe" (the thumb zone, § 5.2). It holds no text of its own: the screen passes the texts.
 */
export function CameraPanel({ chipsLabel, chips, notice, counter, shutter, done }: CameraPanelProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.bg.brandStrong,
        paddingTop: space.inset.sm,
        paddingBottom: space.inset.md + insets.bottom,
        rowGap: space.stack.sm,
      }}
    >
      {notice === undefined ? null : <View style={{ paddingHorizontal: space.inset.md }}>{notice}</View>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={chipsLabel}
        contentContainerStyle={{ paddingHorizontal: space.inset.md, columnGap: space.inline.sm }}
      >
        {chips}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.inset.md }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>{counter}</View>
        {shutter}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{done}</View>
      </View>
    </View>
  );
}
