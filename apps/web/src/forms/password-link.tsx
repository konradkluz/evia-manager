import { Button, InlineAlert } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client.ts';
import { isWrongOrigin } from '../api/panel-address.ts';
import { wrongOriginText } from '../pages/login-failure.tsx';

/**
 * What the two pages that set a password from a one-time link share (W-13 activation, W-12 reset; flows/11 "Zasady
 * wspólne"): the password rules as the server counts them, the failures that keep the form and their texts. The texts
 * live under `activation.*` on purpose — they are the same words on both pages.
 */

/** Password rules of P2 as the server counts them: Unicode code points after NFC (SR-AUTH-01). */
const MIN_LENGTH = 15;
const MAX_LENGTH = 256;

export type FieldProblem = 'too_short' | 'too_long' | 'too_weak';

export function lengthProblem(password: string): FieldProblem | null {
  const length = Array.from(password.normalize('NFC')).length;
  if (length < MIN_LENGTH) return 'too_short';
  return length > MAX_LENGTH ? 'too_long' : null;
}

export function problemText(t: TFunction, problem: FieldProblem): string {
  switch (problem) {
    case 'too_short':
      return t('activation.tooShort');
    case 'too_long':
      return t('activation.tooLong');
    case 'too_weak':
      return t('activation.tooWeak');
  }
}

/** The field-level refusal of the server for the password (`/password` pointer), if that is what the answer was. */
export function passwordProblemOf(error: unknown): FieldProblem | null {
  const field = error instanceof ApiError ? error.errors.find((entry) => entry.pointer === '/password') : undefined;
  return field?.code === 'too_short' || field?.code === 'too_long' || field?.code === 'too_weak' ? field.code : null;
}

/** Failures that keep the form (the link is still fine) and what the user sees. */
export type Failure =
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'server'; readonly code: string }
  | { readonly kind: 'network' }
  | { readonly kind: 'origin' };

export function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.status === 429) return { kind: 'rate', minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) };
    if (error.status === 0) return { kind: 'network' };
    if (isWrongOrigin(error)) return { kind: 'origin' };
    return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
  }
  return { kind: 'network' };
}

export function FailureAlert({
  failure,
  action,
  serverKey,
}: {
  readonly failure: Failure;
  readonly action: () => void;
  readonly serverKey: 'checkFailed' | 'submitFailed';
}) {
  const { t } = useTranslation();
  const retry = (
    <Button variant="tertiary" onClick={action}>
      {t('activation.retry')}
    </Button>
  );
  switch (failure.kind) {
    case 'rate':
      return (
        <InlineAlert tone="error" action={retry}>
          {t('activation.rateLimited', { minutes: failure.minutes })}
        </InlineAlert>
      );
    case 'origin':
      return <InlineAlert tone="error">{wrongOriginText(t, 'activation')}</InlineAlert>;
    case 'network':
      return (
        <InlineAlert tone="error" action={retry}>
          {t('activation.noConnection')}
        </InlineAlert>
      );
    case 'server':
      return (
        <InlineAlert tone="error" action={retry}>
          {serverKey === 'checkFailed'
            ? t('activation.checkFailed', { code: failure.code })
            : t('activation.submitFailed', { code: failure.code })}
        </InlineAlert>
      );
  }
}
