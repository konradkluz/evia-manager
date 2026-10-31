import { Info } from '@evia/ui-web';
import { mediaText } from './media-labels.ts';

/**
 * The mark "Nieskanowany antywirusem — plik za duży" (EVM-046 AC3; SR-FILE-12, P5; styleguide § 4.14 `info`): a film over the limit of
 * the scan passed the structural check only. Text with an icon, so the colour is not the only signal. Shown at the tile, in the lightbox
 * and over the question about the original.
 */
export function UnscannedMark() {
  return (
    <p className="flex items-start gap-inline-xs bg-feedback-info-bg px-inset-xs py-inset-xs text-body-sm text-text-primary">
      <Info aria-hidden="true" className="size-icon-sm shrink-0 text-feedback-info-icon" />
      <span>{mediaText.unscanned}</span>
    </p>
  );
}
