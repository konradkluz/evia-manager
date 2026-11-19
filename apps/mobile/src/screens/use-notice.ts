import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a short notice of a screen stays. */
export const NOTICE_MS = 4_000;

/**
 * A short notice that goes away by itself. EVM-146: under the lock the screen sits in a hidden `Activity`: its effects are cleaned (the timer is
 * cancelled) and run again at the unlock, the state stays - so a notice that was shown at the lock is dropped when the effects run again, it would stay for good.
 */
export function useNotice(): { notice: string | null; say: (message: string) => void; clear: () => void } {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setNotice(null);
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  const say = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
  }, []);
  const clear = useCallback(() => {
    setNotice(null);
  }, []);
  return { notice, say, clear };
}
