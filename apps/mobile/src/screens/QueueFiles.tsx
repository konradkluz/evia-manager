import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Text, View } from 'react-native';
import type { MediaFileView } from '../upload/types';
import { BellOff, Button, InlineAlert } from '../ui';
import { color, space, text } from '../ui/theme';
import { FileRow } from './FileRow';
import { useMediaSnapshot, useSession } from './session-context';

/** Key of the plain-words reason of a file that needs attention (a code of the module or of the table of files; anything else is generic). */
const reasonKey = (code: string | null): 'quarantined' | 'id_conflict' | 'missing_original' | 'unknown' =>
  code === 'quarantined' || code === 'id_conflict' || code === 'missing_original' ? code : 'unknown';

/**
 * The files of the queue in "Kolejka" (EVM-130 AC4, AC6; EVM-108 AC6; flow 09): the Banner of the notifications that are off, the counter of the
 * files still to be sent, the files that need attention ("Ponów" where a retry makes sense, "Usuń z telefonu" where it does not), the files waiting,
 * uploading with the percentage and the error with "Ponów", and the files that were sent. Every file is a row of the shared `FileRow`; it shows a
 * category, the time and a type and a state - no order, name, address, thumbnail or path, so the list is the same in the hidden-data mode (the
 * upload goes on there). "Usuń z telefonu" asks the screen for the confirmation (`onDiscard`).
 */
export function QueueFiles({ onRetryFailed, onDiscard }: { onRetryFailed: () => void; onDiscard: (assetId: string) => void }) {
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
  const reasons: Readonly<Record<ReturnType<typeof reasonKey>, string>> = {
    quarantined: t('upload.reasons.quarantined'),
    id_conflict: t('upload.reasons.id_conflict'),
    missing_original: t('upload.reasons.missing_original'),
    unknown: t('upload.reasons.unknown'),
  };

  const row = (file: MediaFileView) => (
    <FileRow
      key={file.assetId}
      file={file}
      busy={busy === file.assetId}
      {...(file.actions.includes('retry')
        ? {
            onRetry: () => {
              retry(file);
            },
          }
        : {})}
      testID={`file-row-${file.assetId}`}
      retryTestID={`file-retry-${file.assetId}`}
    />
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
        {t('upload.toSend', { count: unsent })}
      </Text>
      {attention.length === 0 ? null : (
        <View style={{ rowGap: space.stack.sm }} testID="files-attention">
          <Text accessibilityRole="header" style={{ ...text.heading4, color: color.text.primary }}>
            {t('upload.sections.attention')}
          </Text>
          {attention.map((file) => (
            <FileRow
              key={file.assetId}
              file={file}
              reason={reasons[reasonKey(file.code)]}
              busy={busy === file.assetId}
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
                      onDiscard(file.assetId);
                    },
                  }
                : {})}
              testID={`file-attention-${file.assetId}`}
              retryTestID={`file-attention-${file.assetId}-retry`}
              discardTestID={`file-attention-${file.assetId}-discard`}
            />
          ))}
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
