import { useEffect, useState } from 'react';
import { IconButton } from './button.tsx';
import { CircleCheck, X } from './icons.ts';

export interface ToastProps {
  /** Text of the toast, `null` when there is none; the live region itself is always present so that changes are announced. */
  readonly message: string | null;
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** Display time in ms (styleguide § 3.14: at least 6 s); paused on hover and focus. */
  readonly duration?: number;
}

/** Toast (styleguide § 3.14): success information on the inverse surface in a polite live region, closable. */
export function Toast({ message, closeLabel, onClose, duration = 6000 }: ToastProps) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (message === null || paused) return;
    const timer = setTimeout(onClose, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [message, paused, duration, onClose]);
  const pause = () => {
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
  };
  return (
    <div role="status" className="fixed bottom-stack-lg start-stack-lg end-stack-lg z-toast flex pointer-events-none">
      {message === null ? null : (
        <div
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={resume}
          className="pointer-events-auto flex items-center gap-inline-md max-w-toast-max-width ps-inset-md bg-bg-inverse text-text-inverse text-body-sm rounded-control shadow-toast"
        >
          <CircleCheck aria-hidden="true" className="size-icon-md shrink-0 text-icon-inverse" />
          <span>{message}</span>
          <IconButton icon={X} label={closeLabel} tone="brand" onClick={onClose} />
        </div>
      )}
    </div>
  );
}
