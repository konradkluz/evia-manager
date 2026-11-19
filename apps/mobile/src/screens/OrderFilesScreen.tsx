import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, Text, View } from 'react-native';
import { filesOfOrder } from '../upload/order-files';
import type { MediaFileView } from '../upload/types';
import { AppBar, Button, Check, CircleCheck, EmptyState, EyeOff, Icon, Inbox, InlineAlert, Skeleton } from '../ui';
import { color, space, text } from '../ui/theme';
import { FileDiscardDialog } from './FileDiscardDialog';
import { FileRow } from './FileRow';
import { fileReason } from './file-reasons';
import { SyncCapsule } from './SyncCapsule';
import { useGuard, useMediaSnapshot, useSession } from './session-context';
import { useAllSentAnnouncement } from './use-all-sent-announcement';
import { useNotice } from './use-notice';
import { useStartup } from '../startup';

/** The count of the header is announced after this much quiet, once (not at every change of a file: EVM-111 AC2). */
const COUNT_ANNOUNCE_MS = 1_500;

/** Key of the label of the action of the hidden-data notice for the reasons that have one (the same words as the notice of the orders, M-05). */
const HIDDEN_ACTION = {
  screen_lock_off: 'hidden.screenLockOff.action',
  contact_expired: 'hidden.contactExpired.action',
  clock_anomaly: 'hidden.clockAnomaly.action',
} as const;

/**
 * M-08 "Pliki zlecenia" (EVM-111 AC1-AC4, AC6): the files of THIS phone that belong to the open order and have not been confirmed by the server - a flat list of
 * the shared `FileRow` (category, time, type, ONE state; the reason in plain words and the same actions as "Kolejka"), over the same snapshot as the Queue; no new
 * queue, no request, no replica of the media of the order. The header says "n do wysłania" or "Wszystko wysłane" (the same number as the row of M-03).
 * - Hidden data, the lock of the app (the order id is the only datum of the navigation): no row, no count and no number of the order, one sentence, and a screen
 *   reader hears nothing (a live region would be a channel of disclosure too). The return shows the list again.
 * - Offline changes nothing here: the files and states are local; the capsule of the bar is the only sign (no banner of the connection).
 * - A failed read of the table: the sentence and "Spróbuj ponownie" (a read only - no row and no file is touched).
 */
export function OrderFilesScreen({ orderId, onBack, onOpenQueue }: { orderId: string; onBack: () => void; onOpenQueue: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const { media } = session;
  const snapshot = useMediaSnapshot();
  const guard = useGuard();
  const online = useStartup().state.kind === 'online';
  const concealed = guard.hidden !== null || guard.locked;
  const [busy, setBusy] = useState<string | null>(null);
  const [toDiscard, setToDiscard] = useState<string | null>(null);
  const { notice, say, clear: clearNotice } = useNotice();

  // a dialog or a notice never outlives the concealment of the data
  useEffect(() => {
    if (!concealed) return;
    setToDiscard(null);
    clearNotice();
  }, [concealed, clearNotice]);

  const ready = snapshot.read === undefined || snapshot.read === 'ready';
  const files = ready && !concealed ? filesOfOrder(snapshot.files, orderId) : [];
  const count = files.length;
  const header = count === 0 ? t('orderFiles.allSent') : t('upload.toSend', { count });

  // "Wszystko wysłane." once, after the server confirmed the last file; silent while the data are concealed
  useAllSentAnnouncement(count, snapshot.confirmed ?? 0, ready && !concealed, t('upload.allSent'));
  // a change of the count is announced together, after a moment of quiet - never when concealed, never at zero (the sentence above says that)
  const lastCount = useRef(count);
  useEffect(() => {
    const before = lastCount.current;
    lastCount.current = count;
    if (!ready || concealed || count === 0 || before === count || before === 0) return undefined;
    const announce = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(t('upload.toSend', { count }));
    }, COUNT_ANNOUNCE_MS);
    return () => {
      clearTimeout(announce);
    };
  }, [count, ready, concealed, t]);

  const retry = (file: MediaFileView): void => {
    setBusy(file.assetId);
    void media
      .retry(file.assetId)
      .then((done) => {
        if (!done) say(t('upload.retryFailed'));
      })
      .catch(() => {
        say(t('upload.retryFailed'));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const hiddenAction =
    guard.hidden !== null && guard.hidden in HIDDEN_ACTION ? t(HIDDEN_ACTION[guard.hidden as keyof typeof HIDDEN_ACTION]) : null;

  const content = () => {
    if (concealed) {
      return (
        <EmptyState
          icon={EyeOff}
          title={t('orderFiles.hidden')}
          testID="order-files-hidden"
          action={
            hiddenAction === null ? undefined : (
              <Button
                label={hiddenAction}
                onPress={() => {
                  if (guard.hidden === 'screen_lock_off') void session.recheckDevice();
                  else void session.reSignIn();
                }}
                testID="order-files-hidden-action"
              />
            )
          }
        />
      );
    }
    if (snapshot.read === 'failed') {
      return (
        <EmptyState
          icon={Inbox}
          title={t('orderFiles.loadFailed')}
          testID="order-files-error"
          action={
            <Button
              label={t('orderFiles.retry')}
              onPress={() => {
                void media.reload();
              }}
              testID="order-files-retry"
            />
          }
        />
      );
    }
    if (snapshot.read === 'loading') return <Skeleton accessibilityLabel={t('orderFiles.loading')} testID="order-files-skeleton" />;
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space.inset.md, rowGap: space.stack.md }} testID="order-files-list">
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }}>
          {count === 0 ? <Icon icon={Check} color={color.feedback.success.icon} iconSize="md" /> : null}
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }} testID="order-files-count">
            {header}
          </Text>
        </View>
        {notice === null ? null : <InlineAlert tone="info" body={notice} testID="order-files-notice" />}
        {count === 0 ? (
          <EmptyState icon={CircleCheck} title={t('orderFiles.empty')} testID="order-files-empty" />
        ) : (
          <View style={{ rowGap: space.stack.xs }}>
            {files.map((file) => (
              <FileRow
                key={file.assetId}
                file={file}
                online={online}
                busy={busy === file.assetId}
                {...(file.status === 'attention' ? { reason: fileReason(t, file) } : {})}
                {...(file.actions.includes('retry')
                  ? {
                      onRetry: () => {
                        retry(file);
                      },
                    }
                  : {})}
                {...(file.actions.includes('discard')
                  ? {
                      onDiscard: () => {
                        setToDiscard(file.assetId);
                      },
                    }
                  : {})}
                testID={`order-file-${file.assetId}`}
                retryTestID={`order-file-${file.assetId}-retry`}
                discardTestID={`order-file-${file.assetId}-discard`}
              />
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg.canvas }} testID="order-files">
      <AppBar
        title={t('orderFiles.title')}
        left={
          <Button
            label={t('orderFiles.back')}
            accessibilityLabel={t('orderFiles.backA11y')}
            variant="tertiary"
            inverse
            onPress={onBack}
            testID="order-files-back"
          />
        }
        right={<SyncCapsule onPress={onOpenQueue} />}
      />
      <View style={{ flex: 1 }}>{content()}</View>
      {toDiscard === null || concealed ? null : (
        <FileDiscardDialog
          onCancel={() => {
            setToDiscard(null);
          }}
          onConfirm={() => {
            const assetId = toDiscard;
            setToDiscard(null);
            void media.discard(assetId).then(
              (removed) => {
                if (!removed) say(t('attention.failed'));
              },
              () => {
                say(t('attention.failed'));
              },
            );
          }}
        />
      )}
    </View>
  );
}
