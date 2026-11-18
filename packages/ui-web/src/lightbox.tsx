import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { zoomedSize, scrollAfterZoom, type Size } from './lightbox-geometry.ts';
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
  /** The accessible name of the picture area (it scrolls when zoomed; focusable for the keyboard, WCAG 2.1.1); a general text, never the file name. */
  readonly scrollAreaLabel: string;
  /** `undefined` disables the button (the first / the last item). */
  readonly onPrevious?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  /** Esc and `x`. */
  readonly onDismiss: () => void;
  /** Changes with the item shown; the zoom goes back to the fit (100%). */
  readonly itemKey: string;
  /** False while the picture is not there (loading, error): zoom buttons are disabled. */
  readonly zoomable?: boolean;
  /**
   * The picture or its Skeleton / error state, in a box the size of the area. The zoom works only for `LightboxImage` (it fits and steps by
   * the factor); a plain `<img>` or other content does not react to the zoom buttons.
   */
  readonly children: ReactNode;
  /** The metadata and the actions under the picture. */
  readonly details: ReactNode;
}

/** Zoom steps as the factor of the fitted size of the picture (percent), the first is the fit: the minimum. */
const ZOOM_STEPS: readonly number[] = [100, 150, 200, 300];

const ZoomContext = createContext<{ readonly factor: number; readonly area: Size | null }>({ factor: 1, area: null });

/**
 * The picture of a `Lightbox` (the only child that reacts to the zoom — a plain `<img>` does not): fitted whole into the scrolling area (never above its natural size), and at a zoom step exactly the fitted
 * size times the factor, so the scrolling area is the picture and nothing else. Until the natural size is known (and where nothing is
 * measured) it is fitted by CSS. The sizes in pixels are geometry, not a style from the tokens.
 */
export function LightboxImage({ alt, onLoad, ...rest }: Omit<ComponentProps<'img'>, 'className' | 'style'> & { readonly alt: string }) {
  const { factor, area } = useContext(ZoomContext);
  const [natural, setNatural] = useState<{ readonly src: string | undefined; readonly size: Size } | null>(null);
  const known = natural !== null && natural.src === rest.src ? natural.size : null;
  const size = known !== null && area !== null ? zoomedSize(known, area, factor) : null;
  const image = useRef<HTMLImageElement>(null);
  // the pixel size is geometry, not a token style: set on the element (no inline style attribute; the lint rule of § 7.2 bans it)
  const width = size === null ? '' : `${String(size.width)}px`;
  const height = size === null ? '' : `${String(size.height)}px`;
  useLayoutEffect(() => {
    if (image.current === null) return;
    image.current.style.width = width;
    image.current.style.height = height;
  }, [width, height]);
  return (
    <img
      {...rest}
      ref={image}
      alt={alt}
      className={size === null ? 'm-auto max-h-full max-w-full object-contain' : 'm-auto max-h-none max-w-none shrink-0'}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) setNatural({ src: rest.src, size: { width: naturalWidth, height: naturalHeight } });
        onLoad?.(event);
      }}
    />
  );
}

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
  scrollAreaLabel,
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
  const scroller = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Size | null>(null);
  const before = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

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

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || !open) return;
    const measure = () => {
      // the outer size (the area has no border or padding): it does not shrink when classic scrollbars (about 17 px on Windows) appear
      // after a zoom, so the fitted size, and with it every step, stays the same
      const { offsetWidth, offsetHeight } = element;
      setArea((current) =>
        offsetWidth > 0 && offsetHeight > 0
          ? current?.width === offsetWidth && current.height === offsetHeight
            ? current
            : { width: offsetWidth, height: offsetHeight }
          : null,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [open]);

  // after a step the same point of the picture stays in the middle of the view (the picture has its new size in this commit)
  useLayoutEffect(() => {
    const element = scroller.current;
    const previous = before.current;
    before.current = null;
    if (element === null || previous === null) return;
    element.scrollLeft = scrollAfterZoom({
      scroll: previous.left,
      client: element.clientWidth,
      before: previous.width,
      after: element.scrollWidth,
    });
    element.scrollTop = scrollAfterZoom({
      scroll: previous.top,
      client: element.clientHeight,
      before: previous.height,
      after: element.scrollHeight,
    });
  }, [step]);

  const changeStep = (delta: number) => {
    const element = scroller.current;
    if (element !== null) {
      before.current = { left: element.scrollLeft, top: element.scrollTop, width: element.scrollWidth, height: element.scrollHeight };
    }
    setStep((current) => Math.min(ZOOM_STEPS.length - 1, Math.max(0, current + delta)));
  };

  const percent = ZOOM_STEPS[step] ?? 100;
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
                  changeStep(-1);
                }}
              />
              <IconButton
                icon={ZoomIn}
                label={zoomInLabel}
                disabled={!canZoom || step === ZOOM_STEPS.length - 1}
                onClick={() => {
                  changeStep(1);
                }}
              />
              <IconButton icon={X} label={closeLabel} onClick={onDismiss} />
            </div>
          </div>
          <span className="sr-only" aria-live="polite">
            {step === 0 ? '' : zoomStatus(percent)}
          </span>
          <div className="flex min-h-0 flex-1 bg-bg-canvas p-inset-sm">
            <div
              ref={scroller}
              role="region"
              aria-label={scrollAreaLabel}
              tabIndex={0}
              className="flex min-h-0 min-w-0 flex-1 overflow-auto focus-visible:focus-ring"
            >
              <ZoomContext.Provider value={{ factor: percent / 100, area }}>
                <div className="m-auto flex h-full w-full shrink-0 items-start">{children}</div>
              </ZoomContext.Provider>
            </div>
          </div>
          <div className="flex flex-col gap-stack-sm p-inset-md">{details}</div>
        </>
      ) : null}
    </dialog>
  );
}
