import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Text, View } from 'react-native';
import { formatDateTime } from '../i18n/format';
import type { MediaFileView } from '../upload/types';
import { AttentionCard, BellOff, Button, InlineAlert, ProgressBar } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';
import { useMediaSnapshot, useSession } from './session-context';

/** Key of the plain-words reason of a file that needs attention (a code of the module or of the table of files; anything else is generic). */
const reasonKey = (code: string | null): 'quarantined' | 'id_conflict' | 'missing_original' | 'unknown' =>
  code === 'quarantined' || code === 'id_conflict' || code === 'missing_original' ? code : 'unknown';

/**
 * The files of the queue in "Kolejka" (EVM-130 AC4, AC6; flow 09): the Banner of the notifications that are off, the files that need
 * attention (cards with "Ponów" where a retry makes sense), the files waiting, uploading with the percentage and the error with "Ponów",
 * and the files that were sent. A file shows a type and a state only — no order, name, address, thumbnail or path, so the list is the
 * same in the hidden-data mode (the upload goes on there). No component of its own: the library's Banner (`InlineAlert`), cards,
 * progress bar and buttons.
 */
export function QueueFiles({ onRetryFailed }: { onRetryFailed: () => void }) {
  const { t } = useTranslation();
  const { media } = useSession();
  const snapshot = useMediaSnapshot();
  const files = snapshot.files;
  const unsent = files.filter((file) => file.status !== 'sent').length;
  const [busy, setBusy] = useState<string | null>(null);

  // "Wszystko wysłane." once, when the last unsent file is gone (a screen reader does not see the list change)
  const before = useRef(unsent);
  useEffect(() => {
    if (before.current > 0 && unsent === 0 && files.length > 0) AccessibilityInfo.announceForAccessibility(t('upload.allSent'));
    before.current = unsent;
  }, [unsent, files.length, t]);

  if (files.length === 0) return null;

  const retry = (file: MediaFileView): void => {
    setBusy(file.assetId);
    void media
      .retry(file.assetId)
      .then((done) => {
        if (!done) onRetryFailed();
      })
      .catch(onRetryFailed)
      .finally(() => {
        setBusy(null);
      });
  };
  const enableNotifications = (): void => {
    // the system prompt first; after a permanent refusal the prompt does not appear, so the settings of the app open
    void media.requestNotifications().then((answer) => (answer === 'granted' ? true : media.openNotificationSettings()));
  };

  const attention = files.filter((file) => file.status === 'attention');
  const rest = files.filter((file) => file.status !== 'attention' && file.status !== 'sent');
  const sent = files.filter((file) => file.status === 'sent');
  const stateText = (file: MediaFileView): string => {
    if (file.status === 'uploading') return t('upload.states.uploading', { percent: file.percent ?? 0 });
    if (file.status === 'waiting') return t('upload.states.waiting');
    return file.status === 'sent' ? t('upload.states.sent') : t('upload.states.error');
  };
  const reasons: Readonly<Record<ReturnType<typeof reasonKey>, string>> = {
    quarantined: t('upload.reasons.quarantined'),
    id_conflict: t('upload.reasons.id_conflict'),
    missing_original: t('upload.reasons.missing_original'),
    unknown: t('upload.reasons.unknown'),
  };

  const row = (file: MediaFileView) => (
    <View
      key={file.assetId}
      accessible
      accessibilityLabel={t('upload.rowA11y', { file: t('upload.file'), state: stateText(file) })}
      style={{
        minHeight: size.touchTarget.min,
        padding: space.inset.sm,
        rowGap: space.stack.xs,
        borderBottomWidth: borderWidth.default,
        borderBottomColor: color.border.subtle,
      }}
      testID={`file-row-${file.assetId}`}
    >
      <Text style={{ ...text.labelLg, color: color.text.primary }}>{t('upload.file')}</Text>
      <Text style={{ ...text.bodySm, color: file.status === 'error' ? color.feedback.error.text : color.text.secondary }}>
        {stateText(file)}
      </Text>
      {file.status === 'uploading' ? (
        <ProgressBar
          value={(file.percent ?? 0) / 100}
          accessibilityLabel={t('upload.progressA11y', { percent: file.percent ?? 0 })}
          testID={`file-progress-${file.assetId}`}
        />
      ) : null}
      {file.actions.includes('retry') ? (
        <Button
          variant="primary"
          label={t('upload.retry')}
          accessibilityLabel={t('upload.retryA11y')}
          onPress={() => {
            retry(file);
          }}
          disabled={busy === file.assetId}
          testID={`file-retry-${file.assetId}`}
        />
      ) : null}
    </View>
  );

  return (
    <View style={{ rowGap: space.stack.md }} testID="queue-files">
      {snapshot.notifications === 'denied' && unsent > 0 ? (
        <InlineAlert
          tone="warning"
          icon={BellOff}
          body={t('upload.notifications.banner')}
          action={
            <Button
              variant="tertiary"
              label={t('upload.notifications.enable')}
              onPress={enableNotifications}
              testID="notifications-enable"
            />
          }
          testID="notifications-banner"
        />
      ) : null}
      <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }} testID="files-summary">
        {t('upload.summary', { sent: sent.length, total: files.length, queued: unsent })}
      </Text>
      {attention.length === 0 ? null : (
        <View style={{ rowGap: space.stack.sm }} testID="files-attention">
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('upload.sections.attention')}
          </Text>
          {attention.map((file) => {
            const reason = reasons[reasonKey(file.code)];
            return (
              <AttentionCard
                key={file.assetId}
                title={t('upload.file')}
                age={t('attention.age', { date: formatDateTime(file.updatedAt) })}
                reason={reason}
                detailsLabel={t('attention.details')}
                details={file.code === null ? [] : [t('attention.detailCode', { code: file.code })]}
                accessibilityLabel={t('attention.accessibleName', { type: t('upload.file'), reason })}
                actions={
                  file.actions.includes('retry')
                    ? [
                        {
                          key: 'retry',
                          label: t('upload.retry'),
                          onPress: () => {
                            retry(file);
                          },
                          disabled: busy === file.assetId,
                          variant: 'primary' as const,
                        },
                      ]
                    : []
                }
                testID={`file-attention-${file.assetId}`}
              />
            );
          })}
        </View>
      )}
      {rest.length === 0 ? null : (
        <View style={{ rowGap: space.stack.xs }} testID="files-waiting">
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('upload.sections.files')}
          </Text>
          {rest.map(row)}
        </View>
      )}
      {sent.length === 0 ? null : (
        <View style={{ rowGap: space.stack.xs }} testID="files-sent">
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('upload.sections.sent')}
          </Text>
          {sent.map(row)}
        </View>
      )}
    </View>
  );
}
