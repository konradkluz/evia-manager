import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { formatDateTime, formatDuration, formatFileSize } from '../i18n/format';
import type { MediaFileView } from '../upload/types';
import { Button, Clock, CloudAlert, CloudCheck, CloudUpload, Icon, ProgressBar, StatusBadge, TriangleAlert, Video } from '../ui';
import { borderWidth, color, size, space, text } from '../ui/theme';

export interface FileRowProps {
  readonly file: MediaFileView;
  /** The reason of a file that needs attention, in plain words (EVM-130); absent for the other states. */
  readonly reason?: string;
  /** An action of this file is running: the buttons are blocked. */
  readonly busy?: boolean;
  /** "Ponów" (EVM-130) - shown only where the caller passes it. */
  readonly onRetry?: () => void;
  /** "Usuń z telefonu" (EVM-108 AC6) - shown only where the caller passes it (the caller asks for the confirmation). */
  readonly onDiscard?: () => void;
  readonly testID: string;
  readonly retryTestID?: string;
  readonly discardTestID?: string;
}

/**
 * One file in a list of files (EVM-108 AC6; the same row will serve "Pliki zlecenia" of EVM-111): the category, the time of the capture and the type, and
 * ONE of the states "Oczekuje" / "Wysyła się 45%" / "Wysłano" / "Wymaga uwagi" (the file that came back damaged keeps its own words of EVM-130). Nothing
 * about the order, the customer, the address or the path - the row cannot show them, so the list is the same in the hidden-data mode. The information
 * (state, percentage) stands in words; the icon and the `color.sync.*` tone only support it. The buttons sit outside the spoken group, so a screen
 * reader reaches each of them. No component of its own: the badge, the progress bar and the buttons of the library.
 */
export function FileRow({ file, reason, busy = false, onRetry, onDiscard, testID, retryTestID, discardTestID }: FileRowProps) {
  const { t } = useTranslation();
  const category = file.category === null || file.category === 'unknown' ? t('upload.noCategory') : t(`camera.categories.${file.category}`);
  const video = file.mediaType === 'video';
  // a film shows its length and size next to the type (EVM-110); never the name of a customer or an address
  const type = video
    ? [
        t('upload.types.video'),
        ...(file.durationMs === undefined || file.durationMs === null ? [] : [formatDuration(file.durationMs)]),
        formatFileSize(file.sizeBytes),
      ].join(' · ')
    : t('upload.types.photo');
  const time = formatDateTime(file.capturedAt);
  const state = stateOf(file, t);
  const attention = file.status === 'attention';
  return (
    <View
      style={{
        minHeight: size.touchTarget.min,
        padding: space.inset.sm,
        rowGap: space.stack.xs,
        borderBottomWidth: borderWidth.default,
        borderBottomColor: color.border.subtle,
        ...(attention ? { borderLeftWidth: borderWidth.indicator, borderLeftColor: color.feedback.error.border } : {}),
      }}
      testID={testID}
    >
      <View
        accessible
        accessibilityLabel={t('upload.fileA11y', { category, type, time, state: state.label })}
        style={{ rowGap: space.stack.xs }}
        testID={`${testID}-info`}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: space.inline.sm }}>
          {video ? <Icon icon={Video} color={color.icon.secondary} iconSize="md" /> : null}
          <Text style={{ ...text.labelLg, color: color.text.primary }}>{category}</Text>
        </View>
        <Text style={{ ...text.bodySm, color: color.text.secondary }} testID={`${testID}-type`}>{`${time} · ${type}`}</Text>
        <StatusBadge icon={state.icon} label={state.label} tone={state.tone} />
        {file.status === 'uploading' ? (
          <ProgressBar
            value={(file.percent ?? 0) / 100}
            accessibilityLabel={t('upload.progressA11y', { percent: file.percent ?? 0 })}
            testID={`file-progress-${file.assetId}`}
          />
        ) : null}
      </View>
      {reason === undefined ? null : <Text style={{ ...text.body, color: color.text.primary }}>{reason}</Text>}
      {onRetry === undefined ? null : (
        <Button
          variant="primary"
          label={t('upload.retry')}
          accessibilityLabel={t('upload.retryA11y')}
          onPress={onRetry}
          disabled={busy}
          testID={retryTestID}
        />
      )}
      {onDiscard === undefined ? null : (
        <Button
          variant="dangerTertiary"
          label={t('attention.actions.discard')}
          accessibilityLabel={t('upload.discardA11y')}
          onPress={onDiscard}
          disabled={busy}
          testID={discardTestID}
        />
      )}
    </View>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function stateOf(file: MediaFileView, t: Translate) {
  switch (file.status) {
    case 'uploading':
      return { label: t('upload.states.uploading', { percent: file.percent ?? 0 }), icon: CloudUpload, tone: color.sync.inProgress };
    case 'sent':
      return { label: t('upload.states.sent'), icon: CloudCheck, tone: color.sync.done };
    case 'error':
      return { label: t('upload.states.error'), icon: CloudAlert, tone: color.sync.error };
    case 'attention':
      return { label: t('upload.states.attention'), icon: TriangleAlert, tone: color.sync.error };
    case 'waiting':
      return { label: t('upload.states.waiting'), icon: Clock, tone: color.sync.queued };
  }
}
