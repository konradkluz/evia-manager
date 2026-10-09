/**
 * The shape of the answers of the module (EVM-031 AC2, AC3): the rows of the database and the names of the people responsible become
 * the objects of the contract. The person responsible is `{id, displayName}` and nothing else (SR-DATA-03); `overdue` and the
 * progress are computed here, from "today" in `Europe/Warsaw` that the caller gives. The party waited for is `{id, displayName}` too
 * (EVM-032, SR-DATA-02): no telephone, e-mail, contact person or note — and `null` when the party is no longer visible (deleted). Every answer is parsed with the schema of the
 * contract before it leaves, so only the fields of the contract can leave; a mismatch is a defect of the server (`500`), never data.
 */
import { zProcedureList, zProcedureStage } from '@evia/contracts/zod';
import type { ProcedureList, ProcedureStage } from '@evia/contracts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { isOpenStage, isOverdue, progressOf } from '../domain/stage-rules.ts';
import { waitingDays } from '../domain/waiting.ts';
import type { ProcedureRow, StageRow } from '../infrastructure/procedure-store.ts';

/** The names of the people responsible, by user identifier. */
export type ResponsibleNames = ReadonlyMap<string, string>;
/** The display names of the parties waited for, by party identifier (only the parties visible to the caller). */
export type PartyNames = ReadonlyMap<string, string>;

const checked = <T>(result: { success: true; data: T } | { success: false }): T => {
  if (!result.success) throw new ProblemException('internal_error');
  return result.data;
};

/** The identifiers of the people responsible named in the stages — each once (the caller asks `identity` in batches). */
export const responsibleIdsOf = (stages: readonly StageRow[]): string[] => [
  ...new Set(stages.flatMap((stage) => (stage.responsible_user_id === null ? [] : [stage.responsible_user_id]))),
];

/** The identifiers of the parties waited for in the stages — each once. */
export const waitingPartyIdsOf = (stages: readonly StageRow[]): string[] => [
  ...new Set(stages.flatMap((stage) => (stage.waiting_on_party_id === null ? [] : [stage.waiting_on_party_id]))),
];

/** `null` for a stage that waits for no party, and for a party that is not visible any more (deleted): the id alone is not shown. */
function waitingPartyOf(stage: StageRow, partyNames: PartyNames) {
  const name = stage.waiting_on_party_id === null ? undefined : partyNames.get(stage.waiting_on_party_id);
  return stage.waiting_on_party_id === null || name === undefined ? null : { id: stage.waiting_on_party_id, displayName: name };
}

function stageView(stage: StageRow, names: ResponsibleNames, partyNames: PartyNames, today: string) {
  const name = stage.responsible_user_id === null ? undefined : names.get(stage.responsible_user_id);
  // the key is a foreign key to the users, so a name is always there; a missing one is a defect, not a stage without a person
  if (stage.responsible_user_id !== null && name === undefined) throw new ProblemException('internal_error');
  return {
    id: stage.id,
    code: stage.code,
    name: stage.name,
    position: stage.position,
    status: stage.status,
    dueDate: stage.due_date,
    overdue: isOverdue({ status: stage.status, dueDate: stage.due_date }, today),
    responsibleUser: stage.responsible_user_id === null || name === undefined ? null : { id: stage.responsible_user_id, displayName: name },
    waitingOn: stage.waiting_on,
    waitingParty: waitingPartyOf(stage, partyNames),
    waitingSince: stage.waiting_since,
    waitingDays: stage.waiting_since === null ? null : waitingDays(stage.waiting_since, today),
    blockedReason: stage.blocked_reason,
    startedAt: stage.started_at === null ? null : stage.started_at.toISOString(),
    completedOn: stage.completed_on,
    version: stage.version,
  };
}

export const toProcedureStage = (stage: StageRow, names: ResponsibleNames, partyNames: PartyNames, today: string): ProcedureStage =>
  checked(zProcedureStage.safeParse(stageView(stage, names, partyNames, today)));

export function toProcedureList(
  procedures: readonly ProcedureRow[],
  stages: readonly StageRow[],
  names: ResponsibleNames,
  partyNames: PartyNames,
  today: string,
): ProcedureList {
  return checked(
    zProcedureList.safeParse({
      items: procedures.map((procedure) => {
        const own = stages.filter((stage) => stage.procedure_id === procedure.id);
        return {
          id: procedure.id,
          code: procedure.code,
          name: procedure.name,
          position: procedure.position,
          progress: progressOf(own),
          stages: own.map((stage) => stageView(stage, names, partyNames, today)),
        };
      }),
      openStageCount: stages.filter((stage) => isOpenStage(stage.status)).length,
    }),
  );
}
