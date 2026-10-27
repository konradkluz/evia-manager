import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { describeEraseFailure, eraseFailureText, removeEntry, restoreEntry, type EraseFailure } from './journal-erase.ts';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';

/**
 * "Usuń wpis" and "Przywróć wpis" (EVM-040 AC1; Administrator): the delete is a soft one, so there is no dialog — a toast says
 * "Usunięto wpis." with "Cofnij", which restores. The version is read just before (`If-Match`), the journal is read again after,
 * and a failure is told in a toast (a conflict or a gone entry also refreshes the journal). One operation at a time.
 */
export function useJournalErase(workOrderId: string) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const busy = useRef(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] });
  const fail = (error: unknown) => {
    const failure: EraseFailure = describeEraseFailure(error);
    if (failure.kind === 'conflict' || failure.kind === 'gone') void refresh();
    showToast(eraseFailureText(t, failure));
  };

  const restore = (entryId: string) => {
    if (busy.current) return;
    busy.current = true;
    restoreEntry(client, workOrderId, entryId)
      .then(() => {
        showToast(t('workOrder.journal.erase.restored'));
        return refresh();
      })
      .catch((error: unknown) => {
        fail(error);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  const remove = (entryId: string) => {
    if (busy.current) return;
    busy.current = true;
    removeEntry(client, workOrderId, entryId)
      .then(() => {
        showToast(t('workOrder.journal.erase.removed'), {
          label: t('workOrder.journal.erase.undo'),
          onSelect: () => {
            restore(entryId);
          },
        });
        return refresh();
      })
      .catch((error: unknown) => {
        fail(error);
      })
      .finally(() => {
        busy.current = false;
      });
  };

  return { remove, restore };
}
