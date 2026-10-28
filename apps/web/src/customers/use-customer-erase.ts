import type { Customer } from '@evia/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import {
  deleteCustomerRecord,
  describeEraseFailure,
  restoreCustomerRecord,
  type CustomerEraseFailure,
  type EraseOperation,
} from './customer-erase.ts';
import { CUSTOMER_KEY, CUSTOMER_LIST_KEY, CUSTOMER_ORDERS_KEY } from './query-keys.ts';

export interface EraseProblem {
  readonly operation: EraseOperation;
  readonly failure: CustomerEraseFailure;
}

/**
 * "Usuń klienta" and "Przywróć klienta" (EVM-041 AC1, AC3, AC8; Administrator): the delete is a soft one, so there is no dialog — a
 * toast says "Usunięto klienta." with "Cofnij", which restores. The effects of a success live in the options of the mutations (not
 * in the callbacks of `mutate`), so they survive a page that is left meanwhile. A failure is never a success toast: it is kept in
 * `problem` for an alert (a conflict, a gone customer and a busy server also read the customer again). The lists and the history
 * of the customer are dropped from the cache after a change — a stale name must not stay on a screen (SR-WEB-05).
 */
export function useCustomerErase(
  id: string,
  handlers: { readonly onGone: () => void; readonly onDependents: (count: number | undefined) => void },
) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [problem, setProblem] = useState<EraseProblem | null>(null);

  const forget = () => {
    queryClient.removeQueries({ queryKey: [CUSTOMER_LIST_KEY] });
    queryClient.removeQueries({ queryKey: [CUSTOMER_ORDERS_KEY, id] });
  };
  const reread = () => queryClient.invalidateQueries({ queryKey: [CUSTOMER_KEY, id] });
  const failed = (operation: EraseOperation) => (error: unknown) => {
    const failure = describeEraseFailure(error);
    if (failure.kind === 'dependents') handlers.onDependents(failure.count);
    if (failure.kind === 'gone') handlers.onGone();
    if (failure.kind === 'conflict' || failure.kind === 'busy' || failure.kind === 'alreadyAnonymized') void reread();
    setProblem({ operation, failure });
  };

  const restore = useMutation({
    mutationFn: () => restoreCustomerRecord(client, id),
    onMutate: () => {
      setProblem(null);
    },
    onSuccess: (restored) => {
      forget();
      queryClient.setQueryData([CUSTOMER_KEY, id], restored);
      showToast(t('customerErase.toast.restored'));
    },
    onError: failed('restore'),
  });

  const remove = useMutation({
    mutationFn: (target: Pick<Customer, 'id' | 'version'>) => deleteCustomerRecord(client, target),
    onMutate: () => {
      setProblem(null);
    },
    onSuccess: () => {
      forget();
      void reread();
      showToast(t('customerErase.toast.deleted'), {
        label: t('customerErase.toast.undo'),
        onSelect: () => {
          restore.mutate();
        },
      });
    },
    onError: failed('delete'),
  });

  return {
    remove: (target: Pick<Customer, 'id' | 'version'>) => {
      if (!remove.isPending && !restore.isPending) remove.mutate(target);
    },
    restore: () => {
      if (!remove.isPending && !restore.isPending) restore.mutate();
    },
    busy: remove.isPending || restore.isPending,
    problem,
    dismissProblem: () => {
      setProblem(null);
    },
  };
}
