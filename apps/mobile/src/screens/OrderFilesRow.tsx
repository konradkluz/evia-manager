import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { filesOfOrder } from '../upload/order-files';
import { Check, ChevronRight, Icon } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';
import { useGuard, useMediaSnapshot } from './session-context';

/**
 * The row "Pliki z tego telefonu" of M-03 (EVM-111 AC1, AC2, AC6): a fixed row in the content above the journal, ONE touch target with a chevron (at least
 * 48 dp, it wraps at 200% of the font). The second line is "n do wysłania" or "Wszystko wysłane" with a check, from the local queue of this phone only; while the
 * table is read, or when the read failed, there is no second line. The accessible name carries the same number ("Pliki z tego telefonu, 3 do wysłania") and
 * is the only thing that changes when the number does - no announcement of its own (the screen "Pliki zlecenia" speaks, this one does not).
 * With the data hidden, the app locked or the session ended the row is NOT there at all (nothing of the order is hinted).
 */
export function OrderFilesRow({ orderId, onOpen }: { orderId: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const guard = useGuard();
  const snapshot = useMediaSnapshot();
  if (guard.hidden !== null || guard.locked) return null;
  const known = snapshot.read === undefined || snapshot.read === 'ready';
  const count = known ? filesOfOrder(snapshot.files, orderId).length : null;
  const second = count === null ? null : count === 0 ? t('orderFiles.allSent') : t('upload.toSend', { count });
  const label =
    count === null ? t('orderFiles.row') : count === 0 ? t('orderFiles.rowA11yAllSent') : t('orderFiles.rowA11yToSend', { count });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('orderFiles.rowHint')}
      onPress={onOpen}
      testID="order-files-row"
      style={({ pressed }) => ({
        minHeight: size.touchTarget.min,
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: space.inline.sm,
        padding: space.inset.md,
        backgroundColor: pressed ? color.bg.surfacePressed : color.bg.surface,
        borderRadius: radius.card,
        borderWidth: borderWidth.default,
        borderColor: color.border.subtle,
      })}
    >
      <View style={{ flex: 1, rowGap: space.stack.xs }}>
        <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('orderFiles.row')}</Text>
        {second === null ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }}>
            {count === 0 ? <Icon icon={Check} color={color.feedback.success.icon} iconSize="sm" /> : null}
            <Text style={{ ...text.bodySm, color: color.text.secondary, flexShrink: 1 }} testID="order-files-row-second">
              {second}
            </Text>
          </View>
        )}
      </View>
      <Icon icon={ChevronRight} color={color.text.secondary} iconSize="md" />
    </Pressable>
  );
}
