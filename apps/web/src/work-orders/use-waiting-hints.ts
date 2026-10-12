import { ApiError } from '../api/client.ts';
import { useParty } from '../parties/use-party.ts';
import { useProcedureTemplates } from './use-order-lookups.ts';
import { useWorkOrderSite } from './use-work-order.ts';
import { buildWaitingHints, type ManagerKind, type WaitingHints } from './waiting-hints.ts';

/**
 * The suggestions and the defaults of the dialog "Na kogo czekamy?" (EVM-033 AC1, AC2, AC4, AC5), read only while the dialog is
 * open: the card of the location (the entry of W-06), the templates of the processes (the default of the stage, joined by the codes
 * of the process and the stage) and, for the manager, the kind of the party — the only field taken from that read (SR-DATA-03).
 * Memory of the tab only. A failed read never blocks the dialog: the search of all the parties works without any of it.
 */
export function useWaitingHints(args: {
  readonly workOrderId: string;
  readonly procedureCode: string;
  readonly stageCode: string;
  readonly enabled: boolean;
}): WaitingHints {
  const { workOrderId, procedureCode, stageCode, enabled } = args;
  const site = useWorkOrderSite(workOrderId, enabled);
  const templates = useProcedureTemplates(enabled);
  const managerId = enabled ? site.data?.manager?.id : undefined;
  const manager = useParty(managerId, (party) => party.kind);

  let managerKind: ManagerKind = 'pending';
  if (manager.data !== undefined) managerKind = manager.data;
  else if (manager.error instanceof ApiError && manager.error.status === 404) managerKind = 'gone';
  else if (manager.isError) managerKind = 'unknown';

  const template = templates.data?.find((procedure) => procedure.code === procedureCode)?.stages.find((stage) => stage.code === stageCode);
  return buildWaitingHints(site.data, managerKind, template);
}
