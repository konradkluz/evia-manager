import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button } from './button.tsx';
import { classNames } from './class-names.ts';
import { CloudUpload, type Icon } from './icons.ts';

export interface UploaderProps {
  /** `dropzone` (web, from `breakpoint.medium`): the drop area with the button; `button` (a phone browser): the button alone. */
  readonly variant?: 'dropzone' | 'button';
  /** The text of the drop area ("Upuść zdjęcia lub filmy tutaj albo"). */
  readonly dropLabel?: string;
  /** The label of the button ("Wybierz pliki", "Wybierz z galerii"); the button always exists (WCAG 2.5.7). */
  readonly buttonLabel: string;
  /** Accessible name of the file input (the hidden control behind the button). */
  readonly inputLabel: string;
  /** The allowed types and limits, always visible (SR-FILE-01). */
  readonly hint?: ReactNode;
  /** `accept` of the input — a convenience of the picker; the panel and the server check the files again. */
  readonly accept?: string;
  readonly buttonIcon?: Icon;
  readonly disabled?: boolean;
  readonly className?: string;
  /** The chosen or dropped files (never empty). */
  readonly onFiles: (files: File[]) => void;
}

/**
 * Uploader (styleguide § 3.12, web): a drop area with the visible button "Wybierz pliki" and the list of types and limits.
 * Dragging is an addition — the button always works. The input is operated by the button (it is not a tab stop of its own).
 */
export function Uploader({
  variant = 'dropzone',
  dropLabel,
  buttonLabel,
  inputLabel,
  hint,
  accept,
  buttonIcon,
  disabled = false,
  className,
  onFiles,
}: UploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const dropzone = variant === 'dropzone';

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragOver={
        dropzone
          ? (event) => {
              event.preventDefault();
              if (!disabled) setOver(true);
            }
          : undefined
      }
      onDragLeave={
        dropzone
          ? () => {
              setOver(false);
            }
          : undefined
      }
      onDrop={dropzone ? drop : undefined}
      className={classNames(
        'flex flex-col items-start gap-stack-sm',
        dropzone ? 'p-inset-lg rounded-card border-w-default border-border-strong' : undefined,
        over ? 'bg-bg-selected border-border-selected' : undefined,
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-inline-md">
        {dropzone ? (
          <>
            <CloudUpload aria-hidden="true" className="size-icon-md shrink-0 text-icon-secondary" />
            {dropLabel === undefined ? null : <span className="text-body text-text-primary">{dropLabel}</span>}
          </>
        ) : null}
        <Button
          variant={dropzone ? 'secondary' : 'primary'}
          {...(buttonIcon === undefined ? {} : { icon: buttonIcon })}
          disabled={disabled}
          aria-describedby={hint === undefined ? undefined : hintId}
          onClick={() => input.current?.click()}
        >
          {buttonLabel}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-label={inputLabel}
        {...(accept === undefined ? {} : { accept })}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          // The same file can be chosen again after a failure: the input is emptied.
          event.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-body-sm text-text-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}
