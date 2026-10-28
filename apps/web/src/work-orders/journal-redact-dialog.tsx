import type { TimelineEntry } from '@evia/contracts';
import { AlertDialog, Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGuardedCall } from '../administration/use-guarded-call.ts';
import { useApi } from '../api/api-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { describeEraseFailure, eraseFailureText, redactEntry, replaceEntryInCache, type EraseFailure } from './journal-erase.ts';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';

/**
 * "Zredagować treść wpisu?" (EVM-040 AC2, AC3, AC7; W-08, § 4.11): an irreversible operation, so the focus starts on "Anuluj". After
 * "Zredaguj treść" W-04 opens when the server asks for it (`403 step_up_required`) and the same call is sent again; cancelling it
 * says "Nie wykonano operacji." and changes nothing. A refused register is `503` — "Nie udało się zredagować treści. Spróbuj ponownie
 * później." — and the text is untouched. The dialog and the toast name no content; on success the entry of the cache is replaced
 * with the answer of the server (the old text does not stay in the memory of the tab).
 */
export function JournalRedactDialog({
  workOrderId,
  entry,
  onClose,
}: {
  readonly workOrderId: string;
  readonly entry: TimelineEntry;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const guarded = useGuardedCall(t('workOrder.journal.erase.stepUpTitle'));
  const [failure, setFailure] = useState<EraseFailure | null>(null);

  // The effects of the call live in the options of the mutation (not in the callbacks of `mutate`), and while it runs the dialog
  // cannot be dismissed: a dialog that unmounts mid-flight would lose the replacement of the cache and the toast.
  const mutation = useMutation({
    mutationFn: () => guarded.run(() => redactEntry(client, workOrderId, entry.id)),
    onSuccess: (redacted) => {
      replaceEntryInCache(queryClient, workOrderId, redacted);
      void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] });
      showToast(t('workOrder.journal.erase.redacted'));
      onClose();
    },
    onError: (error) => {
      const failed = describeEraseFailure(error);
      if (failed.kind === 'conflict' || failed.kind === 'gone' || failed.kind === 'alreadyRedacted') {
        void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] });
      }
      setFailure(failed);
    },
  });
  const running = mutation.isPending;
  const dismiss = () => {
    if (!running) onClose();
  };

  const confirm = () => {
    setFailure(null);
    mutation.mutate();
  };

  return (
    <AlertDialog
      open={!guarded.stepping}
      title={t('workOrder.journal.erase.redactTitle')}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant="tertiary" data-initial-focus disabled={running} onClick={dismiss}>
            {t('workOrder.journal.erase.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={!online}
            {...(online ? {} : { title: t('workOrder.journal.erase.offline') })}
            onClick={confirm}
          >
            {t('workOrder.journal.erase.redactConfirm')}
          </Button>
        </>
      }
    >
      <p>{t('workOrder.journal.erase.redactBody')}</p>
      {online ? null : <Banner icon={WifiOff}>{t('workOrder.journal.erase.offline')}</Banner>}
      {failure === null ? null : <InlineAlert tone="error">{eraseFailureText(t, failure)}</InlineAlert>}
    </AlertDialog>
  );
}
