import { useEffect, useState } from 'react';

/**
 * The local clock as state: refreshed every `intervalMs`, and at once when the tab becomes visible, gets focus or the
 * network returns — a computer that slept does not wait for the next tick. No request is made here.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => {
      setNow(Date.now());
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    const timer = globalThis.setInterval(update, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    globalThis.addEventListener('focus', update);
    globalThis.addEventListener('online', update);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      globalThis.removeEventListener('focus', update);
      globalThis.removeEventListener('online', update);
    };
  }, [intervalMs]);
  return now;
}
