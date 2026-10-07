import { useRef } from 'react';
import { uuidv7 } from '../customers/uuid.ts';

/**
 * The name of a request to create something (EVM-021 AC2, AC4): the identifier of the new object (`id`, UUIDv7) and the
 * `Idempotency-Key`. The same content gets the same pair on every retry (a lost answer never makes a duplicate); changed
 * content, or `forget()` after a refused pair, starts anew.
 */
export function useAttempt() {
  const current = useRef<{ readonly content: string; readonly id: string; readonly key: string } | null>(null);
  return {
    next(content: string): { readonly id: string; readonly key: string } {
      if (current.current?.content !== content) current.current = { content, id: uuidv7(), key: uuidv7() };
      return current.current;
    },
    forget(): void {
      current.current = null;
    },
  };
}
