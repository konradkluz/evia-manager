import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useStartup } from '../startup';
import { AlertDialog, AppBar, Button } from '../ui';
import { borderWidth, color, space, text } from '../ui/theme';
import { SyncCapsule } from './SyncCapsule';
import { useSession } from './session-context';

/** Polish plural of "niewysłany element" (1 / 2–4 / 5+; 12–14 are "many"). */
export function unsentKey(count: number): 'logout.unsentOne' | 'logout.unsentFew' | 'logout.unsentMany' {
  if (count === 1) return 'logout.unsentOne';
  const tens = count % 100;
  const units = count % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? 'logout.unsentFew' : 'logout.unsentMany';
}

/**
 * The sign-out warning (EVM-100 AC7; M-09, styleguide § 4.11): with unsent items their number, "Najpierw wyślij" (disabled offline,
 * the reason in the text), "Wyloguj mimo to" and access to "Wyczyść dane firmowe"; without them a plain confirmation.
 */
export function LogoutDialog({
  unsentItems,
  online,
  busy,
  onConfirm,
  onSendFirst,
  onWipe,
  onCancel,
}: {
  unsentItems: number;
  online: boolean;
  busy: boolean;
  onConfirm: () => void;
  onSendFirst: () => void;
  onWipe: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const withUnsent = unsentItems > 0;
  return (
    <AlertDialog
      title={t('logout.title')}
      onCancel={onCancel}
      testID="logout-dialog"
      actions={
        <>
          {withUnsent ? (
            <>
              <Button label={t('logout.sendFirst')} onPress={onSendFirst} disabled={!online || busy} fullWidth testID="logout-send-first" />
              {online ? null : <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('logout.sendFirstOffline')}</Text>}
              <Button
                label={t('logout.confirmWithUnsent')}
                onPress={onConfirm}
                variant="danger"
                busy={busy}
                fullWidth
                testID="logout-confirm"
              />
            </>
          ) : (
            <Button label={t('logout.confirm')} onPress={onConfirm} busy={busy} fullWidth testID="logout-confirm" />
          )}
          <Button label={t('logout.cancel')} onPress={onCancel} variant="tertiary" disabled={busy} fullWidth testID="logout-cancel" />
          <Button label={t('logout.wipe')} onPress={onWipe} variant="dangerTertiary" disabled={busy} fullWidth testID="logout-wipe" />
        </>
      }
    >
      <Text style={{ ...text.body, color: color.text.primary }} testID="logout-body">
        {withUnsent ? t(unsentKey(unsentItems), { count: unsentItems }) : t('logout.plain')}
      </Text>
    </AlertDialog>
  );
}

/** The sign-out flow of M-09 (AC7): the dialog is rendered by the shell over the whole window, the navigation included. */
export function useSignOutFlow(openQueue: () => void) {
  const session = useSession();
  const { state } = useStartup();
  const online = state.kind !== 'offline';
  const [unsent, setUnsent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    if (!busy) setUnsent(null);
  }, [busy]);
  const ask = useCallback(() => {
    void session.unsentItemCount().then(setUnsent, () => {
      setUnsent(0);
    });
  }, [session]);
  const dialog =
    unsent === null ? null : (
      <LogoutDialog
        unsentItems={unsent}
        online={online}
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void session.signOut().finally(() => {
            setBusy(false);
          });
        }}
        onSendFirst={() => {
          // the sending itself is EVM-107; until then "Najpierw wyślij" opens the queue
          setUnsent(null);
          openQueue();
        }}
        onWipe={() => {
          setUnsent(null);
          session.requestCompanyDataWipe();
        }}
        onCancel={cancel}
      />
    );
  return { ask, dialog };
}

/**
 * "Więcej" (M-09) — the part EVM-100 needs (AC7): the name of the user, where account settings live, "Pomoc", the version, "Wyloguj"
 * and, separated at the bottom, "Wyczyść dane firmowe" (EVM-101). Upload and handling switches arrive with their stories.
 */
export function MoreScreen({ onOpenQueue, onSignOut }: { onOpenQueue: () => void; onSignOut: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>
      <AppBar title={t('shell.more.title')} right={<SyncCapsule onPress={onOpenQueue} />} />
      <ScrollView contentContainerStyle={{ padding: space.inset.md, rowGap: space.stack.lg }}>
        <Text style={{ ...text.heading3, color: color.text.primary }} testID="more-user">
          {session.displayName}
        </Text>
        <View style={{ rowGap: space.stack.xs }}>
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('more.account')}
          </Text>
          <Text style={{ ...text.body, color: color.text.secondary }}>{t('more.accountNote')}</Text>
        </View>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label={t('more.help')} variant="tertiary" onPress={session.openHelp} testID="more-help" />
        </View>
        <Text style={{ ...text.bodySm, color: color.text.secondary }}>{t('more.version', { version: session.appVersion })}</Text>
        <Button label={t('more.signOut')} onPress={onSignOut} fullWidth testID="more-sign-out" />
        <View style={{ borderTopWidth: borderWidth.default, borderTopColor: color.border.subtle, paddingTop: space.stack.md }}>
          <Button label={t('more.wipe')} variant="dangerTertiary" onPress={session.requestCompanyDataWipe} fullWidth testID="more-wipe" />
        </View>
      </ScrollView>
    </View>
  );
}
