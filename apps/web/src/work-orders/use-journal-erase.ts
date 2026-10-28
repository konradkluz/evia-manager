import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useApi } from '../api/api-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useTranslation } from 'react-i18next';
import { describeEraseFailure, removeEntry, restoreEntry, type EraseFailure } from './journal-erase.ts';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';

/**
 * "Usuń wpis" and "Przywróć wpis" (EVM-040 AC1; Administrator): the delete is a soft one, so there is no dialog — a toast says
 * "Usunięto wpis." with "Cofnij", which restores. The version is read just before (`If-Match`) and the journal is read again after
 * (not awaited, so it never holds the next operation). A failure is not a success toast: it is kept in `failure` for an alert
 * (a conflict or a gone entry also refreshes the journal). One operation at a time from the menu; "Cofnij" is never dropped — it
 * waits for the operation in flight and then runs.
 */
export function useJournalErase(workOrderId: string) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [failure, setFailure] = useState<EraseFailure | null>(null);
  const tail = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] }),
    [queryClient, workOrderId],
  );
  const fail = (error: unknown) => {
    const failed = describeEraseFailure(error);
    if (failed.kind === 'conflict' || failed.kind === 'gone') void refresh();
    setFailure(failed);
  };

  const enqueue = (operation: () => Promise<void>, fromUndo: boolean) => {
    if (pending.current > 0 && !fromUndo) return;
    pending.current += 1;
    setFailure(null);
    tail.current = tail.current
      .then(operation)
      .catch(fail)
      .finally(() => {
        pending.current -= 1;
      });
  };

  const restore = (entryId: string, fromUndo = false) => {
    enqueue(async () => {
      await restoreEntry(client, workOrderId, entryId);
      showToast(t('workOrder.journal.erase.restored'));
      void refresh();
    }, fromUndo);
  };

  const remove = (entryId: string) => {
    enqueue(async () => {
      await removeEntry(client, workOrderId, entryId);
      showToast(t('workOrder.journal.erase.removed'), {
        label: t('workOrder.journal.erase.undo'),
        onSelect: () => {
          restore(entryId, true);
        },
      });
      void refresh();
    }, false);
  };

  const dismissFailure = () => {
    setFailure(null);
  };

  return { remove, restore, failure, dismissFailure };
}
