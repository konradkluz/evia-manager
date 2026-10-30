import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './button.tsx';
import { ArrowLeft, ArrowRight, X, ZoomIn, ZoomOut } from './icons.ts';

export interface LightboxProps {
  readonly open: boolean;
  /** The accessible name of the dialog (it is not shown): what is being viewed. */
  readonly title: string;
  readonly closeLabel: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly zoomInLabel: string;
  readonly zoomOutLabel: string;
  /** The text announced politely after a zoom step, e.g. "Powiększenie 150%". */
  readonly zoomStatus: (percent: number) => string;
  /** `undefined` disables the button (the first / the last item). */
  readonly onPrevious?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  /** Esc and `x`. */
  readonly onDismiss: () => void;
  /** Changes with the item shown; the zoom goes back to 100%. */
  readonly itemKey: string;
  /** False while the picture is not there (loading, error): zoom buttons are disabled. */
  readonly zoomable?: boolean;
  /** The picture (or its Skeleton / error state). It fills the width of the area; the zoom widens it. */
  readonly children: ReactNode;
  /** The metadata and the actions under the picture. */
  readonly details: ReactNode;
}

/** Zoom steps as the scale of the picture inside a scrolling area (percent; scaled from the top left corner, so the scrolling area grows right and down; classes written out so that Tailwind finds them). */
const ZOOM_STEPS: ReadonlyArray<{ readonly percent: number; readonly className: string }> = [
  { percent: 100, className: 'w-full' },
  { percent: 150, className: 'w-full origin-top-left scale-150' },
  { percent: 200, className: 'w-full origin-top-left scale-200' },
  { percent: 300, className: 'w-full origin-top-left scale-300' },
];

/**
 * Lightbox (styleguide § 3.11): a full-screen modal <dialog> (the page behind is inert, focus is trapped and returns to the opener on
 * closing) with "Poprzednie" / "Następne" buttons (arrows of the keyboard too, while not zoomed), a zoom with buttons (no gesture needed),
 * `x` and Esc. The picture and the metadata are the parent's: the component knows no domain. Not animated, no injected styles.
 */
export function Lightbox({
  open,
  title,
  closeLabel,
  previousLabel,
  nextLabel,
  zoomInLabel,
  zoomOutLabel,
  zoomStatus,
  onPrevious,
  onNext,
  onDismiss,
  itemKey,
  zoomable = true,
  children,
  details,
}: LightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
  }, [itemKey, open]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    (element.querySelector<HTMLElement>('[data-initial-focus]') ?? element.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      element.close();
      // the focus of the closed dialog may be on an element that is gone: put it back on the tile that opened it (WCAG 2.4.3)
      const active = document.activeElement;
      if (opener?.isConnected === true && (active === null || active === document.body || element.contains(active))) opener.focus();
    };
  }, [open]);

  const zoom = ZOOM_STEPS[step] ?? ZOOM_STEPS[0];
  const canZoom = zoomable;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onKeyDown={(event) => {
        if (step !== 0 || event.target instanceof HTMLInputElement) return;
        if (event.key === 'ArrowLeft' && onPrevious !== undefined) onPrevious();
        if (event.key === 'ArrowRight' && onNext !== undefined) onNext();
      }}
      className="m-0 h-full max-h-none w-full max-w-none p-0 bg-bg-surface text-text-primary open:flex open:flex-col backdrop:bg-bg-scrim"
    >
      {open ? (
        <>
          <h2 id={`${id}-title`} className="sr-only">
            {title}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-inline-md p-inset-sm">
            <div className="flex items-center gap-inline-sm">
              <IconButton icon={ArrowLeft} label={previousLabel} disabled={onPrevious === undefined} onClick={onPrevious} />
              <IconButton icon={ArrowRight} label={nextLabel} disabled={onNext === undefined} onClick={onNext} />
            </div>
            <div className="flex items-center gap-inline-sm">
              <IconButton
                icon={ZoomOut}
                label={zoomOutLabel}
                disabled={!canZoom || step === 0}
                onClick={() => {
                  setStep((current) => Math.max(0, current - 1));
                }}
              />
              <IconButton
                icon={ZoomIn}
                label={zoomInLabel}
                disabled={!canZoom || step === ZOOM_STEPS.length - 1}
                onClick={() => {
                  setStep((current) => Math.min(ZOOM_STEPS.length - 1, current + 1));
                }}
              />
              <IconButton icon={X} label={closeLabel} onClick={onDismiss} />
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {step === 0 ? '' : zoomStatus(zoom?.percent ?? 100)}
          </span>
          <div className="flex min-h-0 flex-1 overflow-auto bg-bg-canvas p-inset-sm">
            <div className={`m-auto shrink-0 ${zoom?.className ?? 'origin-top-left'}`}>{children}</div>
          </div>
          <div className="flex flex-col gap-stack-sm p-inset-md">{details}</div>
        </>
      ) : null}
    </dialog>
  );
}
