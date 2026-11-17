import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { pluralKey } from '../i18n/plural';
import { expiryOf, type Expiry } from '../orders/site-survey-model';
import { CalendarX, Icon, Trash, TriangleAlert } from '../ui';
import { color, space, text } from '../ui/theme';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The term of a survey as a text (flow 17, rule 3): "Wygasa za 80 dni" / "Wygasa za 1 dzień" / "Wygasa dziś" / "Termin minął — wizja zostanie
 * wkrótce usunięta."; a survey the office rejected counts down to its removal: "Usunięcie za 9 dni". Plural forms by `pluralKey` (Polish).
 */
export function surveyTermText(t: Translate, expiry: Expiry, rejected: boolean): string {
  if (expiry.state === 'overdue') return t('orderDetail.surveyOverdue');
  if (rejected) {
    return t(
      pluralKey(expiry.days, {
        one: 'orderDetail.surveyRemoval_one',
        few: 'orderDetail.surveyRemoval_few',
        many: 'orderDetail.surveyRemoval_many',
      }),
      { count: expiry.days },
    );
  }
  if (expiry.state === 'today') return t('orderDetail.surveyToday');
  return t(
    pluralKey(expiry.days, {
      one: 'orderDetail.surveyExpires_one',
      few: 'orderDetail.surveyExpires_few',
      many: 'orderDetail.surveyExpires_many',
    }),
    { count: expiry.days },
  );
}

/** The term with an icon - a text first, the colour and the icon only add (a warning is `triangle-alert` and the warning colour). */
export function SurveyTerm({ expiresAt, rejected = false, testID }: { expiresAt: number; rejected?: boolean; testID?: string }) {
  const { t } = useTranslation();
  const expiry = expiryOf(expiresAt, Date.now());
  const warn = !rejected && expiry.state !== 'normal';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }} testID={testID}>
      <Icon
        icon={rejected ? Trash : warn ? TriangleAlert : CalendarX}
        color={warn ? color.icon.warning : color.icon.secondary}
        iconSize="sm"
      />
      <Text style={{ ...text.body, color: warn ? color.text.warning : color.text.secondary, flexShrink: 1 }}>
        {surveyTermText(t, expiry, rejected)}
      </Text>
    </View>
  );
}
