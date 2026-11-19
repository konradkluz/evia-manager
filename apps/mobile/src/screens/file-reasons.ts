import type { MediaFileView } from '../upload/types';

type Translate = (key: string) => string;

/** Key of the plain-words reason of a file that needs attention (a code of the module or of the table of files; anything else is generic). */
type ReasonKey =
  | 'quarantined'
  | 'id_conflict'
  | 'missing_original'
  | 'order_gone'
  | 'survey_photo_gone'
  | 'survey_video_gone'
  | 'command_rejected'
  | 'unknown';

function reasonKey(file: MediaFileView): ReasonKey {
  const { code } = file;
  if (code === 'quarantined' || code === 'id_conflict' || code === 'missing_original') return code;
  if (code === 'order_gone' || code === 'command_rejected') return code;
  if (code === 'survey_gone') return file.mediaType === 'video' ? 'survey_video_gone' : 'survey_photo_gone';
  // EVM-111 AC4: a code this version does not know (also one that looks like a path or an object key) is the general sentence - never shown itself
  return 'unknown';
}

/**
 * The reason of a file in "Wymaga uwagi" in plain words, from the CLOSED dictionary of `upload.reasons.*` (EVM-130, EVM-108 AC6, EVM-111 AC4): the technical
 * code of the quarantine and any code of another version never reach the screen, an accessible name or a log. One place for "Kolejka" and "Pliki zlecenia".
 */
export function fileReason(t: Translate, file: MediaFileView): string {
  switch (reasonKey(file)) {
    case 'quarantined':
      return t('upload.reasons.quarantined');
    case 'id_conflict':
      return t('upload.reasons.id_conflict');
    case 'missing_original':
      return t('upload.reasons.missing_original');
    case 'order_gone':
      return t('upload.reasons.order_gone');
    case 'survey_photo_gone':
      return t('upload.reasons.survey_photo_gone');
    case 'survey_video_gone':
      return t('upload.reasons.survey_video_gone');
    case 'command_rejected':
      return t('upload.reasons.command_rejected');
    case 'unknown':
      return t('upload.reasons.unknown');
  }
}
