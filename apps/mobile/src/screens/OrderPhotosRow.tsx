import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { pluralKey } from '../i18n/plural';
import { ChevronRight, Icon } from '../ui';
import { borderWidth, color, radius, size, space, text } from '../ui/theme';
import { useOrderPhotos } from './order-photos-hooks';

/**
 * The row "Zdjęcia zlecenia" of M-03 (EVM-142 AC2, AC5, AC6): the same card and ONE touch target as "Pliki z tego telefonu" (at least 48 dp, it wraps at 200% of the font), right above it.
 * The second line is the number of the photos of the order in the replica ("1 zdjęcie", "3 zdjęcia", "12 zdjęć", "Brak zdjęć") - the replica, so it does not depend on the network; while
 * it is read (or when the read failed) there is no second line. The accessible name carries the same ("Zdjęcia zlecenia, 12 zdjęć") and is the only thing that changes with the number -
 * no announcement. With the data hidden, the app locked or the session ended the row is NOT there at all, and nothing is read.
 */
export function OrderPhotosRow({ orderId, onOpen }: { orderId: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const { concealed, photos, failed } = useOrderPhotos(orderId);
  if (concealed) return null;
  const count = photos === null || failed ? null : photos.length;
  const second =
    count === null
      ? null
      : count === 0
        ? t('orderPhotos.none')
        : t(pluralKey(count, { one: 'orderPhotos.count_one', few: 'orderPhotos.count_few', many: 'orderPhotos.count_many' }), { count });
  const label =
    count === null ? t('orderPhotos.row') : count === 0 ? t('orderPhotos.rowA11yNone') : `${t('orderPhotos.row')}, ${second ?? ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('orderPhotos.rowHint')}
      onPress={onOpen}
      testID="order-photos-row"
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
        <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('orderPhotos.row')}</Text>
        {second === null ? null : (
          <Text style={{ ...text.bodySm, color: color.text.secondary }} testID="order-photos-row-second">
            {second}
          </Text>
        )}
      </View>
      <Icon icon={ChevronRight} color={color.text.secondary} iconSize="md" />
    </Pressable>
  );
}
