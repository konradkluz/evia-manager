import { useCallback, useEffect, useRef } from 'react';

/**
 * Runs the outcome of an asynchronous save on the screen. Under the lock the content is a hidden `Activity`: React cleans its effects and runs
 * them again at the unlock, the state stays (EVM-146). So "the effects were cleaned" is not "the screen is gone": an outcome that comes back
 * while the screen is hidden waits and is applied when its effects run again; an outcome that comes back after the screen was really removed
 * never runs (its effect does not run again).
 */
export function useSettled(): (apply: () => void) => void {
  const live = useRef(true);
  const waiting = useRef<(() => void)[]>([]);
  useEffect(() => {
    live.current = true;
    const due = waiting.current;
    waiting.current = [];
    for (const apply of due) apply();
    return () => {
      live.current = false;
    };
  }, []);
  return useCallback((apply: () => void) => {
    if (live.current) apply();
    else waiting.current.push(apply);
  }, []);
}
