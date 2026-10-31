import { useEffect, useRef, useState } from 'react';
import { mediaText } from './media-labels.ts';

// The player of the preview 720p of a film in the lightbox (EVM-046 AC4; SR-FILE-10, P10). The signed address of the preview lives 300 s and
// a film lasts up to 30 min; a browser reads it with Range requests, so a request after the end of the address is refused (403) in the middle
// of the film. The lifetime of the address is not made longer - the player asks for a new address instead and goes back to the second where
// it was: when the film reports an error, and a little before the end of the address when the film is not being played. One try per error;
// a film that fails again says so (W-09) instead of looping. Nothing here is logged or kept: the addresses live in the state of the component.

export interface VideoTicket {
  readonly url: string;
  /** ISO 8601 instant at which the address stops working. */
  readonly expiresAt: string;
}

/** The renewal starts this long before the end of the address (a request in flight still has to arrive). */
export const REFRESH_MARGIN_MS = 30_000;
/** A renewal is never planned sooner than this, whatever the clock of the server says (no loop of requests on a skewed clock). */
const MIN_RENEW_GAP_MS = 5_000;
/** Winding with the arrows of the keyboard. */
const SEEK_SECONDS = 5;

/** How long to wait before the renewal of an address: until the margin before its end; never negative. */
export function refreshDelay(expiresAt: string | number, now: number): number {
  const end = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  return Math.max(0, end - now - REFRESH_MARGIN_MS);
}

/** Space or K plays and pauses, the arrows wind by 5 s, F goes full screen (and back); Esc is left to the lightbox. */
function onPlayerKey(event: React.KeyboardEvent<HTMLVideoElement>): void {
  const video = event.currentTarget;
  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      event.preventDefault();
      if (video.paused) void Promise.resolve(video.play()).catch(() => undefined);
      else video.pause();
      return;
    case 'ArrowLeft':
    case 'ArrowRight': {
      // the arrows belong to the player; they must not turn the page of the lightbox
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowLeft' ? -SEEK_SECONDS : SEEK_SECONDS;
      const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
      video.currentTime = Math.min(end, Math.max(0, video.currentTime + step));
      return;
    }
    case 'f':
    case 'F':
      event.preventDefault();
      if (document.fullscreenElement === null) void Promise.resolve(video.requestFullscreen()).catch(() => undefined);
      else void Promise.resolve(document.exitFullscreen()).catch(() => undefined);
      return;
    default:
  }
}

export function VideoPlayer({
  initial,
  label,
  renew,
}: {
  readonly initial: VideoTicket;
  /** The accessible name of the player (the film, never the file name). */
  readonly label: string;
  /** A new address of the same preview (the request goes through the API: limits, audit and `404` / `403` as always). */
  readonly renew: () => Promise<VideoTicket>;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [ticket, setTicket] = useState(initial);
  const [failed, setFailed] = useState(false);
  // where to go back to once the new address has loaded, and whether the film was playing
  const resume = useRef<{ readonly time: number; readonly play: boolean } | null>(null);
  const renewing = useRef(false);
  // an error since the last time the film loaded: a second one is not tried again
  const triedAfterError = useRef(false);
  // the end of the address came while the film was playing
  const stale = useRef(false);
  const renewRef = useRef(renew);
  renewRef.current = renew;

  const renewNow = () => {
    const element = video.current;
    if (renewing.current || element === null) return;
    renewing.current = true;
    stale.current = false;
    const place = { time: element.currentTime, play: !element.paused && !element.ended };
    renewRef
      .current()
      .then((next) => {
        resume.current = place;
        setTicket(next);
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        renewing.current = false;
      });
  };

  // The clock of the address: shortly before its end a film that is not being played gets a new one; a film that plays is not interrupted.
  const { expiresAt } = ticket;
  useEffect(() => {
    const timer = setTimeout(
      () => {
        const element = video.current;
        if (element === null || element.paused || element.ended) renewNow();
        else stale.current = true;
      },
      Math.max(MIN_RENEW_GAP_MS, refreshDelay(expiresAt, Date.now())),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [expiresAt]);

  if (failed)
    return (
      <p role="alert" className="p-inset-lg text-center text-body text-text-secondary">
        {mediaText.videoUnavailable}
      </p>
    );
  return (
    // The film of a person at work has no spoken text to caption (a recording of a measurement); the file is data of the user, not authored content.
    <video
      ref={video}
      src={ticket.url}
      controls
      playsInline
      tabIndex={0}
      preload="metadata"
      aria-label={label}
      className="h-auto w-full bg-bg-canvas"
      onKeyDown={onPlayerKey}
      onLoadedMetadata={(event) => {
        const place = resume.current;
        if (place === null) return;
        resume.current = null;
        event.currentTarget.currentTime = place.time;
        // a film that was stopped stays stopped: no autoplay
        if (place.play) void Promise.resolve(event.currentTarget.play()).catch(() => undefined);
      }}
      onLoadedData={() => {
        triedAfterError.current = false;
      }}
      onPause={() => {
        if (stale.current) renewNow();
      }}
      onError={() => {
        if (triedAfterError.current) {
          setFailed(true);
          return;
        }
        triedAfterError.current = true;
        renewNow();
      }}
    />
  );
}
