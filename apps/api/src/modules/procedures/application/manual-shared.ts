/**
 * What the commands of EVM-042 (the addition, the deletion and the restoration of a process or a stage) share: the process as the
 * answer, and the two events of every change — the audit record (an action of its own, so the removal and the return of a record are
 * always told apart, TM-21) and the entry of the journal (EVM-038). Both carry identifiers and the stable CODE of the process only,
 * never the name of a stage: it is free text typed by the user and may name a person (SR-LOG-03, SR-DATA-01; RODO art. 17).
 */
import type { Procedure } from '@evia/contracts';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { UserDirectory } from '../../identity/index.ts';
import type { PartyDirectory } from '../../parties/index.ts';
import type { ProcedureAuditEvent, ProcedureMembershipEvent } from '../events.ts';
import { findLiveProcedure, listStagesOfProcedure } from '../infrastructure/manual-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { toProcedure, waitingPartyIdsOf } from './procedure-representation.ts';
import { responsibleNamesOf } from './responsible-names.ts';

/** The objects the commands change. */
export type ManualObject = 'procedure' | 'procedure_stage';
export type ManualAction = 'created' | 'deleted' | 'restored';

const AUDITED = {
  procedure: { created: 'procedure.created', deleted: 'procedure.deleted', restored: 'procedure.restored' },
  procedure_stage: { created: 'procedure_stage.created', deleted: 'procedure_stage.deleted', restored: 'procedure_stage.restored' },
} as const;
const JOURNALED = {
  procedure: { created: 'procedure.added', deleted: 'procedure.removed', restored: 'procedure.reinstated' },
  procedure_stage: { created: 'procedure_stage.added', deleted: 'procedure_stage.removed', restored: 'procedure_stage.reinstated' },
} as const;

export interface ManualChange {
  readonly object: ManualObject;
  readonly action: ManualAction;
  /** The process or the stage. */
  readonly objectId: string;
  readonly workOrderId: string;
  /** The stable code of the process (of the stage's process for a stage). */
  readonly procedureCode: string;
}

/** Publishes the audit event and the event of the journal of one change, in the transaction of the command. */
export async function publishManualChange(
  events: EventBus,
  tx: Kysely<Database>,
  principal: Principal,
  change: ManualChange,
  request: EventContext,
): Promise<void> {
  const actor = { type: 'user', userId: principal.userId } as const;
  const base = { actor, outcome: 'success', objectId: change.objectId } as const;
  const audited: ProcedureAuditEvent =
    change.object === 'procedure'
      ? { ...base, type: AUDITED.procedure[change.action], objectType: 'procedure' }
      : { ...base, type: AUDITED.procedure_stage[change.action], objectType: 'procedure_stage' };
  await events.publish(tx, audited, request);
  const journal: ProcedureMembershipEvent = {
    type: JOURNALED[change.object][change.action],
    actor,
    outcome: 'success',
    objectType: change.object,
    objectId: change.objectId,
    workOrderId: change.workOrderId,
    procedureCode: change.procedureCode,
  };
  await events.publish(tx, journal, request);
}

/**
 * The process of THIS order as it is NOW with its live stages (`id AND work_order_id AND deleted_at is null`): the answer of an
 * addition, of a restore and of their repeats. A repeat reads the process again with the policy of the moment, so a process that was
 * deleted since the first request is `404` — an idempotent repeat never returns what the caller may not see now.
 */
export async function presentProcedure(
  deps: { readonly users: UserDirectory; readonly parties: PartyDirectory; readonly clock: Clock },
  tx: Kysely<Database>,
  principal: Principal,
  orderId: string,
  procedureId: string,
): Promise<Procedure> {
  const tables = procedureTables(tx);
  const row = await findLiveProcedure(tables, orderId, procedureId);
  if (row === undefined) throw new ProblemException('not_found');
  const stages = await listStagesOfProcedure(tables, orderId, procedureId);
  const names = await responsibleNamesOf(
    deps.users,
    tx,
    stages.flatMap((stage) => (stage.responsible_user_id === null ? [] : [stage.responsible_user_id])),
  );
  const partyNames = await deps.parties.namesOf(tx, principal, waitingPartyIdsOf(stages));
  return toProcedure(row, stages, names, partyNames, businessDate(deps.clock.now()));
}

/** `422 limit_exceeded`: a pointer and a code, no value (SR-ERR-02). */
export const limitExceeded = (code: 'too_many_procedures' | 'too_many_stages'): ProblemException =>
  new ProblemException('limit_exceeded', { errors: [{ pointer: '', code }] });
