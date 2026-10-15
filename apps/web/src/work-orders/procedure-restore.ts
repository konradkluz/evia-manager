import {
  listDeletedWorkOrderProcedures,
  restoreProcedureStage,
  restoreWorkOrderProcedure,
  type Client,
  type DeletedProcedureList,
} from '@evia/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { unwrap } from '../api/client.ts';
import { uuidv7 } from '../customers/uuid.ts';
import { etagOf } from './procedure-manage.ts';
import { WORK_ORDER_DELETED_PROCEDURES_KEY, WORK_ORDER_JOURNAL_KEY, WORK_ORDER_PROCEDURES_KEY } from './query-keys.ts';

export type RestoreKind = 'procedure' | 'stage';

/**
 * Restores a deleted process or stage (EVM-042 AC3; Administrator only, no step-up): `If-Match` of the version the list of the deleted
 * ones gave, an `Idempotency-Key` that is the same for a retry. The answer is the restored object; the panel reads the lists again.
 */
export async function sendRestore(
  client: Client,
  workOrderId: string,
  kind: RestoreKind,
  id: string,
  version: number,
  key: string,
): Promise<void> {
  const headers = { 'If-Match': etagOf(version), 'Idempotency-Key': key };
  if (kind === 'procedure') await unwrap(restoreWorkOrderProcedure({ client, path: { workOrderId, procedureId: id }, headers }));
  else await unwrap(restoreProcedureStage({ client, path: { workOrderId, stageId: id }, headers }));
}

/** The current version of a deleted object (the delete does not answer with it): read from the list of the deleted ones. */
export async function readDeletedVersion(client: Client, workOrderId: string, kind: RestoreKind, id: string): Promise<number | undefined> {
  const deleted: DeletedProcedureList = await unwrap(listDeletedWorkOrderProcedures({ client, path: { workOrderId } }));
  return (kind === 'procedure' ? deleted.procedures : deleted.stages).find((entry) => entry.id === id)?.version;
}

/**
 * "Cofnij" of a deletion (the Administrator only): the version of the deleted object is read from the list of the deleted ones, then
 * the object is restored under a fresh `Idempotency-Key`; the lists are read again. The Editor has no "Cofnij" (the server says `403`).
 */
export async function undoDelete(
  client: Client,
  queryClient: QueryClient,
  workOrderId: string,
  kind: RestoreKind,
  id: string,
): Promise<void> {
  const version = await readDeletedVersion(client, workOrderId, kind, id);
  if (version === undefined) throw new Error('the deleted object is gone');
  await sendRestore(client, workOrderId, kind, id, version, uuidv7());
  await refreshAfterRestore(queryClient, workOrderId);
}

/** The processes, the list of the deleted ones and the journal are read again after a restore (the journal got an event). */
export async function refreshAfterRestore(queryClient: QueryClient, workOrderId: string): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, workOrderId] });
  await Promise.all([
    queryClient.refetchQueries({ queryKey: [WORK_ORDER_PROCEDURES_KEY, workOrderId] }),
    queryClient.refetchQueries({ queryKey: [WORK_ORDER_DELETED_PROCEDURES_KEY, workOrderId] }),
  ]);
}
