import { StatusBar } from 'expo-status-bar';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, BackHandler, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BlockedVariant } from '../auth/login-machine';
import type { SessionEndReason } from '../auth/ports';
import { Ban, BottomBar, Button, Download, EmptyState, KeyRound, ListChecks, LogOut, ShieldOff, Smartphone } from '../ui';
import { color, space, text } from '../ui/theme';

/** Every variant of M-02 that EVM-100 shows (AC3 before a session, AC4/AC7 at its end). */
export type DeviceStateVariant = BlockedVariant | SessionEndReason;

interface VariantCopy {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  /** Sentence about the unsent items; absent when the variant has none (or N = 0). */
  readonly unsent?: string;
  readonly primary: 'backToSignIn' | 'signIn' | 'retry' | 'viewQueue';
}

/** The texts are keys of the catalogue (UX 01 M-02 "Stany urządzenia" with the changes of UX 16). */
const VARIANTS: Readonly<Record<DeviceStateVariant, VariantCopy>> = {
  channel_not_allowed: {
    icon: Ban,
    title: 'deviceState.channelNotAllowed.title',
    body: 'deviceState.channelNotAllowed.body',
    primary: 'backToSignIn',
  },
  totp_not_configured: {
    icon: KeyRound,
    title: 'deviceState.totpNotConfigured.title',
    body: 'deviceState.totpNotConfigured.body',
    unsent: 'deviceState.unsentAfterSignIn',
    primary: 'backToSignIn',
  },
  mfa_enrollment_required: {
    icon: KeyRound,
    title: 'deviceState.mfaEnrollmentRequired.title',
    body: 'deviceState.mfaEnrollmentRequired.body',
    unsent: 'deviceState.unsentAfterSignIn',
    primary: 'backToSignIn',
  },
  device_limit_reached: {
    icon: Smartphone,
    title: 'deviceState.deviceLimit.title',
    body: 'deviceState.deviceLimit.body',
    primary: 'retry',
  },
  client_version_unsupported: {
    icon: Download,
    title: 'deviceState.updateRequired.title',
    body: 'deviceState.updateRequired.body',
    unsent: 'deviceState.updateRequired.unsent',
    primary: 'viewQueue',
  },
  session_revoked: {
    icon: LogOut,
    title: 'deviceState.sessionRevoked.title',
    body: 'deviceState.sessionRevoked.body',
    unsent: 'deviceState.unsentSameAccount',
    primary: 'signIn',
  },
  session_expired: {
    icon: LogOut,
    title: 'deviceState.sessionExpired.title',
    body: 'deviceState.sessionExpired.body',
    unsent: 'deviceState.unsentExpired',
    primary: 'signIn',
  },
  signed_out: {
    icon: LogOut,
    title: 'deviceState.signedOut.title',
    body: 'deviceState.signedOut.body',
    unsent: 'deviceState.unsentSameAccount',
    primary: 'signIn',
  },
  device_wipe_required: { icon: ShieldOff, title: 'deviceState.wiped.title', body: 'deviceState.wiped.body', primary: 'signIn' },
};

const PRIMARY_LABEL = {
  backToSignIn: 'deviceState.backToSignIn',
  signIn: 'deviceState.signIn',
  retry: 'deviceState.retry',
  viewQueue: 'deviceState.viewQueue',
} as const;

function useTitleFocus() {
  const ref = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (ref.current !== null) AccessibilityInfo.sendAccessibilityEvent(ref.current, 'focus');
  }, []);
  return ref;
}

/** The system "back" never leaves a blocking state (styleguide § 3.15.1). */
function useBlockBack() {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      subscription.remove();
    };
  }, []);
}

function BlockingLayout({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas, paddingTop: insets.top }}>
      <StatusBar style="dark" />
      <Text style={{ ...text.labelLg, color: color.text.secondary, padding: space.inset.md }}>{t('shell.appName')}</Text>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{children}</ScrollView>
      <BottomBar>{footer}</BottomBar>
    </View>
  );
}

/**
 * M-02 "Stany urządzenia" (EVM-100 AC3, AC4, AC7; styleguide § 3.15.1): a full-screen blocking state without the bottom navigation,
 * the title gets the reader focus, one main action in the bottom bar and the secondary "Pomoc" (M-11). No data of work orders is
 * rendered; unsent items appear as a number only, and the sentence is left out when there are none.
 */
export function DeviceStateScreen({
  variant,
  unsentItems,
  onPrimary,
  onHelp,
}: {
  variant: DeviceStateVariant;
  unsentItems: number | null;
  onPrimary: () => void;
  onHelp: () => void;
}) {
  const { t } = useTranslation();
  const titleRef = useTitleFocus();
  useBlockBack();
  const copy = VARIANTS[variant];
  const unsent = copy.unsent !== undefined && unsentItems !== null && unsentItems > 0 ? t(copy.unsent, { count: unsentItems }) : null;
  return (
    <BlockingLayout
      footer={
        <>
          <Button label={t(PRIMARY_LABEL[copy.primary])} onPress={onPrimary} buttonSize="lg" fullWidth testID="device-state-primary" />
          <Button label={t('deviceState.help')} onPress={onHelp} variant="tertiary" fullWidth testID="device-state-help" />
        </>
      }
    >
      <EmptyState
        blocking
        icon={copy.icon}
        title={t(copy.title)}
        description={t(copy.body)}
        titleRef={titleRef}
        testID={`device-state-${variant}`}
      >
        {unsent === null ? null : (
          <Text style={{ ...text.body, color: color.text.secondary, textAlign: 'center' }} testID="device-state-unsent">
            {unsent}
          </Text>
        )}
      </EmptyState>
    </BlockingLayout>
  );
}

/**
 * "Zobacz kolejkę" of "Aktualizacja wymagana" (AC3): a read-only preview of the queue — its number only, no names and no thumbnails
 * (styleguide § 3.15.1). The queue stays encrypted and nothing is sent while the version is unsupported.
 */
export function QueuePreviewScreen({ unsentItems, onBack }: { unsentItems: number | null; onBack: () => void }) {
  const { t } = useTranslation();
  const titleRef = useTitleFocus();
  useBlockBack();
  return (
    <BlockingLayout
      footer={<Button label={t('deviceState.queuePreview.back')} onPress={onBack} buttonSize="lg" fullWidth testID="queue-preview-back" />}
    >
      <EmptyState
        blocking
        icon={ListChecks}
        title={t('deviceState.queuePreview.title')}
        description={
          unsentItems !== null && unsentItems > 0 ? t('deviceState.queuePreview.body', { count: unsentItems }) : t('shell.queue.emptyTitle')
        }
        titleRef={titleRef}
        testID="queue-preview"
      />
    </BlockingLayout>
  );
}
