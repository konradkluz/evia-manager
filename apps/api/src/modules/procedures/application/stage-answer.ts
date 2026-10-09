/**
 * What the change of a stage and its transition share (EVM-031, EVM-032): the check of the party waited for and the answer, i.e. the
 * stage of THIS order as it is NOW with the names of the people and parties it shows.
 */
import type { ProcedureStage } from '@evia/contracts';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { UserDirectory } from '../../identity/index.ts';
import type { PartyDirectory } from '../../parties/index.ts';
import { findStage } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { toProcedureStage, waitingPartyIdsOf } from './procedure-representation.ts';
import { responsibleNamesOf } from './responsible-names.ts';

/** The columns of the model that no answer of a stage carries: a request that names one gets `read_only_field`, not `unknown_field` (SR-AUTHZ-04). */
export const HIDDEN_STAGE_COLUMNS: readonly string[] = [
  'procedureId',
  'workOrderId',
  'outputDocumentKindCodes',
  'sourceStageTemplateId',
  'notes',
];

/**
 * The party waited for exists and is visible to the caller. It is read through the facade of `parties` and LOCKED (`FOR SHARE`) in
 * the transaction of the command, so it cannot be deleted between the check and the write (TOCTOU, SR-INPUT-02). A party that does
 * not exist and one that is deleted are ONE answer for every role — `400`, the pointer and `unknown_party`, never the id.
 */
export async function requireVisibleParty(
  parties: PartyDirectory,
  tx: Kysely<Database>,
  principal: Principal,
  partyId: string | null,
): Promise<void> {
  if (partyId === null) return;
  const kinds = await parties.kindsOf(tx, principal, [partyId], { lock: true });
  if (!kinds.has(partyId)) {
    throw new ProblemException('validation_failed', { errors: [{ pointer: '/waitingOnPartyId', code: 'unknown_party' }] });
  }
}

/** The stage of THIS order as it is NOW, with the name of the person responsible and of the party waited for. */
export async function presentStage(
  deps: { readonly users: UserDirectory; readonly parties: PartyDirectory; readonly clock: Clock },
  tx: Kysely<Database>,
  principal: Principal,
  orderId: string,
  stageId: string,
): Promise<ProcedureStage> {
  const row = await findStage(procedureTables(tx), orderId, stageId);
  const names = await responsibleNamesOf(deps.users, tx, row.responsible_user_id === null ? [] : [row.responsible_user_id]);
  const partyNames = await deps.parties.namesOf(tx, principal, waitingPartyIdsOf([row]));
  return toProcedureStage(row, names, partyNames, businessDate(deps.clock.now()));
}
