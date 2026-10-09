import { InlineAlert } from '@evia/ui-web';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/client.ts';
import { isWrongOrigin, supportedPanelAddress } from '../api/panel-address.ts';

/** Message for a request rejected because the panel was opened under an unsupported address (EVM-077 AC6). */
export function wrongOriginText(t: TFunction, scope: 'login' | 'activation'): string {
  const address = supportedPanelAddress();
  if (scope === 'login') {
    return address === undefined ? t('login.wrongOriginNoAddress') : t('login.wrongOrigin', { address });
  }
  return address === undefined ? t('activation.wrongOriginNoAddress') : t('activation.wrongOrigin', { address });
}

/** What the user sees after a failed login step; the first two are the same for every account (SR-AUTH-05, CWE-204). */
export type LoginFailure =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'rate'; readonly minutes: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'origin' }
  | { readonly kind: 'server'; readonly code: string };

/** `Retry-After` in seconds → whole minutes, never less than 1 (the time comes from the server, not from the page). */
export function retryMinutes(error: ApiError): number {
  return Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
}

export function describeLoginFailure(error: unknown): LoginFailure {
  if (!(error instanceof ApiError)) return { kind: 'network' };
  if (error.status === 429) return { kind: 'rate', minutes: retryMinutes(error) };
  if (error.status === 0) return { kind: 'network' };
  if (error.status === 400 || error.status === 401) return { kind: 'invalid' };
  if (isWrongOrigin(error)) return { kind: 'origin' };
  return { kind: 'server', code: error.traceId?.slice(0, 8) ?? error.code };
}

/** One alert for the failure of a step; focus can be moved to it (styleguide § 4.1: the error is announced and reached). */
export function LoginFailureAlert({ failure, alertRef }: { readonly failure: LoginFailure; readonly alertRef?: Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  const text = (() => {
    switch (failure.kind) {
      case 'invalid':
        return t('login.invalid');
      case 'rate':
        return t('login.rateLimited', { minutes: failure.minutes });
      case 'network':
        return t('login.noConnection');
      case 'origin':
        return wrongOriginText(t, 'login');
      case 'server':
        return t('login.serverError', { code: failure.code });
    }
  })();
  return (
    <InlineAlert tone="error" {...(alertRef === undefined ? {} : { alertRef })}>
      {text}
    </InlineAlert>
  );
}
