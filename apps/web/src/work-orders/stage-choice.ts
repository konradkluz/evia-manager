import type { ProcedureList } from '@evia/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { SelectGroup, SelectOption } from '@evia/ui-web';
import { useCallback } from 'react';
import { ApiError } from '../api/client.ts';
import { WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';
import { useWorkOrderProcedures } from './use-work-order.ts';

/** The value of the Select "Etap" for "no stage" (the API takes `null`). */
export const NO_STAGE = '';

export interface StageChoice {
  readonly id: string;
  readonly name: string;
  readonly processName: string;
}

/** The stages of the order in the order of the processes and positions (EVM-048 AC1: only the stages of THIS order). */
export function stageChoices(list: ProcedureList | undefined): StageChoice[] {
  return (list?.items ?? []).flatMap((procedure) =>
    procedure.stages.map((stage) => ({ id: stage.id, name: stage.name, processName: procedure.name })),
  );
}

/** Options of the Select: "Bez etapu" first, then the stages (grouped by process when the order has more than one). */
export function stageSelectOptions(choices: readonly StageChoice[], noneLabel: string): Array<SelectOption | SelectGroup> {
  const none: SelectOption = { value: NO_STAGE, label: noneLabel };
  const processes = [...new Set(choices.map((choice) => choice.processName))];
  if (processes.length <= 1) return [none, ...choices.map((choice) => ({ value: choice.id, label: choice.name }))];
  return [
    none,
    ...processes.map((processName) => ({
      label: processName,
      options: choices.filter((choice) => choice.processName === processName).map((choice) => ({ value: choice.id, label: choice.name })),
    })),
  ];
}

/** The order of the stages for the grouping (ids in the order of the processes). */
export function stageOrder(choices: readonly StageChoice[]): string[] {
  return choices.map((choice) => choice.id);
}

/** `400 validation_failed` about `procedureStageId`: a stage of another order, a removed one or one that never existed (one answer for all three). */
export function isStageRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && error.errors.some((entry) => entry.pointer.endsWith('/procedureStageId'));
}

/** The stages of the order from the shared read of W-06 and a way to read them again (after "etap usunięty w międzyczasie"). */
export function useStageChoices(workOrderId: string, enabled = true) {
  const procedures = useWorkOrderProcedures(workOrderId, enabled);
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, workOrderId] }),
    [queryClient, workOrderId],
  );
  return { choices: stageChoices(procedures.data), refresh, failed: procedures.isError };
}
