import { Button, InlineAlert, Skeleton } from '@evia/ui-web';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Loading of one section of W-06 (styleguide § 4.12, EVM-018 AC7): a skeleton of lines with a text status for assistive
 * technology; the container carries `aria-busy`. The sections load after the header (the header is shown first).
 */
export function SectionLoading({ lines = 3 }: { readonly lines?: number }) {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-sm">
      <p role="status" className="sr-only">
        {t('workOrder.loading.section')}
      </p>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

/** The error of one section (AC7): an alert inside the section with "Spróbuj ponownie"; the other sections keep working. */
export function SectionError({
  message,
  retryLabel,
  onRetry,
}: {
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  return (
    <InlineAlert
      tone="error"
      action={
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    >
      {message}
    </InlineAlert>
  );
}

/** One term of a description list (a label above its value) in a card of W-06; the value is React text or a link. */
export function DetailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-stack-xs">
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd className="break-words text-body text-text-primary">{children}</dd>
    </div>
  );
}
