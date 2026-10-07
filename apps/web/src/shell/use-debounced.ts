import { useEffect, useState } from 'react';

/** `value` after it has stayed unchanged for `delayMs` (a search starts when the typing pauses, not at every key). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}
