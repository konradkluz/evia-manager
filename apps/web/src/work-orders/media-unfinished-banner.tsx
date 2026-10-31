import { Banner, Button, CircleAlert } from '@evia/ui-web';
import { mediaText } from './media-labels.ts';
import type { MediaUpload } from './use-media.ts';

/**
 * The banner "Nie wysłano 3 zdjęć — wybierz je ponownie z galerii." above the tabs of W-06 (EVM-044 AC4; W-09 w przeglądarce telefonu,
 * makieta 1): the person's own unfinished upload sessions that this tab is not sending — a tab that was closed or dropped from the
 * memory of the phone before the end. The names of the files come from the server, not from the storage of the browser (SR-WEB-05), and
 * are shown as text. Another person's session and another order never appear (`404` for the session, the list is the caller's only).
 * A named region, read with the page; "Wybierz ponownie z galerii" opens the dialog where the same files resume their sessions.
 */
export function MediaUnfinishedBanner({ media, onChoose }: { readonly media: MediaUpload; readonly onChoose: () => void }) {
  const { unfinished } = media;
  if (unfinished.length === 0) return null;
  const videos = unfinished.filter((asset) => asset.mediaType === 'video');
  // EVM-046 AC8: films are told as films ("Nie wysłano filmu „VID_0415.mp4” — …"), a mix as files
  const kind = videos.length === 0 ? 'photo' : videos.length === unfinished.length ? 'video' : 'mixed';
  const single = kind === 'video' && videos.length === 1 ? videos[0] : undefined;
  const sentence =
    single !== undefined
      ? mediaText.unfinishedVideo(single.originalFilename ?? mediaText.video)
      : kind === 'video'
        ? mediaText.unfinishedVideos(unfinished.length)
        : kind === 'mixed'
          ? mediaText.unfinishedFiles(unfinished.length)
          : mediaText.unfinished(unfinished.length);
  return (
    <Banner icon={CircleAlert} label={mediaText.unfinishedBannerFor(kind)}>
      <p>{sentence}</p>
      {single === undefined ? (
        <p className="break-words">{unfinished.map((asset) => asset.originalFilename ?? mediaText.photo).join(' · ')}</p>
      ) : null}
      <p className="text-body-sm text-text-secondary">{mediaText.unfinishedHelp}</p>
      <div>
        <Button variant="secondary" size="lg" onClick={onChoose}>
          {mediaText.chooseAgain}
        </Button>
      </div>
    </Banner>
  );
}
