import type { Customer } from '@evia/contracts';
import { AlertDialog, Banner, Button, Checkbox, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { anonymizeCustomerRecord, describeEraseFailure, eraseFailureText, type CustomerEraseFailure } from './customer-erase.ts';

export interface AnonymizeCustomerDialogProps {
  /** The customer as the page holds it: its version is the `If-Match` of the call. */
  readonly customer: Customer;
  /** The server anonymized the customer (the answer replaces the page's copy); the effects live in the options of the mutation. */
  readonly onDone: (anonymized: Customer) => void;
  /** Closing without the operation. */
  readonly onClose: () => void;
  /** The customer is gone (`404`) or was anonymized meanwhile (`already_anonymized`): the page reads it again. */
  readonly onStale: (failure: CustomerEraseFailure) => void;
  /** The server named the number of open work orders (`409 has_active_dependents`): the menu disables both operations. */
  readonly onDependents: (count: number | undefined) => void;
}

/**
 * "Zanonimizować klienta …?" (EVM-041 AC2, AC4, AC5, AC7, AC8; W-14, flow 13, § 4.11): irreversible, so the focus starts on "Anuluj",
 * the dialog names the FIELDS that change (never their values) and asks for a tick instead of retyping the name (WCAG 3.3.8). After
 * "Anonimizuj klienta" W-04 opens when the server asks for it (`403 step_up_required`) and the same call is sent again; cancelling
 * it says "Nie wykonano operacji." and changes nothing. While the call runs the dialog cannot be dismissed (a dialog that unmounts
 * mid-flight would lose the replacement of the cache and the toast). A refused register is `503` with a code: the data is untouched.
 */
export function AnonymizeCustomerDialog({ customer, onDone, onClose, onStale, onDependents }: AnonymizeCustomerDialogProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const guarded = useGuardedCall(t('customerErase.dialog.stepUpTitle'));
  const [understood, setUnderstood] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<CustomerEraseFailure | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const tick = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<'tick' | 'confirm' | null>(null);

  const mutation = useMutation({
    mutationFn: () => guarded.run(() => anonymizeCustomerRecord(client, customer)),
    onSuccess: (anonymized) => {
      onDone(anonymized);
    },
    onError: (error) => {
      const failed = describeEraseFailure(error);
      if (failed.kind === 'dependents') onDependents(failed.count);
      if (failed.kind === 'gone' || failed.kind === 'alreadyAnonymized' || failed.kind === 'conflict' || failed.kind === 'busy') {
        onStale(failed);
      }
      setFailure(failed);
      if (failed.kind === 'notConfirmed') setFocusRequest('confirm');
    },
  });
  const running = mutation.isPending;

  // The dialog stood aside for W-04 and is back: the focus goes where the person left off (§ 3.13).
  useEffect(() => {
    if (focusRequest === 'confirm') confirmButton.current?.focus();
    else if (focusRequest === 'tick') tick.current?.querySelector('input')?.focus();
    if (focusRequest !== null) setFocusRequest(null);
  }, [focusRequest]);

  const dismiss = () => {
    if (!running) onClose();
  };
  const confirm = () => {
    setFailure(null);
    if (!understood) {
      setMissing(true);
      setFocusRequest('tick');
      return;
    }
    mutation.mutate();
  };

  return (
    <AlertDialog
      open={!guarded.stepping}
      title={t('customerErase.dialog.title', { name: customer.displayName })}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus disabled={running} onClick={dismiss}>
            {t('customerErase.dialog.cancel')}
          </Button>
          <Button
            ref={confirmButton}
            variant="danger"
            loading={running}
            disabled={!online}
            {...(online ? {} : { title: t('customerErase.dialog.offline') })}
            onClick={confirm}
          >
            {t('customerErase.dialog.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('customerErase.dialog.lead')}</p>
      <p className="font-semibold">{t('customerErase.dialog.replacedHeading')}</p>
      <ul className="list-disc ps-inset-lg">
        <li>{t('customerErase.dialog.replacedNames')}</li>
        <li>{t('customerErase.dialog.replacedContact')}</li>
      </ul>
      <p className="font-semibold">{t('customerErase.dialog.keptHeading')}</p>
      <ul className="list-disc ps-inset-lg">
        <li>{t('customerErase.dialog.keptOrders')}</li>
        <li>{t('customerErase.dialog.keptSites')}</li>
        <li>{t('customerErase.dialog.keptJournal')}</li>
      </ul>
      <p>{t('customerErase.dialog.procedure')}</p>
      <div ref={tick}>
        <Checkbox
          label={t('customerErase.dialog.understand')}
          checked={understood}
          disabled={running}
          onChange={(checked) => {
            setUnderstood(checked);
            if (checked) setMissing(false);
          }}
        />
        {missing && !understood ? <InlineAlert tone="error">{t('customerErase.dialog.understandMissing')}</InlineAlert> : null}
      </div>
      {online ? null : <Banner icon={WifiOff}>{t('customerErase.dialog.offline')}</Banner>}
      {failure === null ? null : <InlineAlert tone="error">{eraseFailureText(t, 'anonymize', failure)}</InlineAlert>}
    </AlertDialog>
  );
}
