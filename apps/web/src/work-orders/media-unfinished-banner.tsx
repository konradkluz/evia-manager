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
  return (
    <Banner icon={CircleAlert} label={mediaText.unfinishedBanner}>
      <p>{mediaText.unfinished(unfinished.length)}</p>
      <p className="break-words">{unfinished.map((asset) => asset.originalFilename ?? mediaText.photo).join(' · ')}</p>
      <p className="text-body-sm text-text-secondary">{mediaText.unfinishedHelp}</p>
      <div>
        <Button variant="secondary" size="lg" onClick={onChoose}>
          {mediaText.chooseAgain}
        </Button>
      </div>
    </Banner>
  );
}
