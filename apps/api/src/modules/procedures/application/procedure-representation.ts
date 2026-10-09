/**
 * The shape of the answers of the module (EVM-031 AC2, AC3): the rows of the database and the names of the people responsible become
 * the objects of the contract. The person responsible is `{id, displayName}` and nothing else (SR-DATA-03); `overdue` and the
 * progress are computed here, from "today" in `Europe/Warsaw` that the caller gives. Every answer is parsed with the schema of the
 * contract before it leaves, so only the fields of the contract can leave; a mismatch is a defect of the server (`500`), never data.
 */
import { zProcedureList, zProcedureStage } from '@evia/contracts/zod';
import type { ProcedureList, ProcedureStage } from '@evia/contracts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { isOpenStage, isOverdue, progressOf } from '../domain/stage-rules.ts';
import type { ProcedureRow, StageRow } from '../infrastructure/procedure-store.ts';

/** The names of the people responsible, by user identifier. */
export type ResponsibleNames = ReadonlyMap<string, string>;

const checked = <T>(result: { success: true; data: T } | { success: false }): T => {
  if (!result.success) throw new ProblemException('internal_error');
  return result.data;
};

/** The identifiers of the people responsible named in the stages — each once (the caller asks `identity` in batches). */
export const responsibleIdsOf = (stages: readonly StageRow[]): string[] => [
  ...new Set(stages.flatMap((stage) => (stage.responsible_user_id === null ? [] : [stage.responsible_user_id]))),
];

function stageView(stage: StageRow, names: ResponsibleNames, today: string) {
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
    version: stage.version,
  };
}

export const toProcedureStage = (stage: StageRow, names: ResponsibleNames, today: string): ProcedureStage =>
  checked(zProcedureStage.safeParse(stageView(stage, names, today)));

export function toProcedureList(
  procedures: readonly ProcedureRow[],
  stages: readonly StageRow[],
  names: ResponsibleNames,
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
          stages: own.map((stage) => stageView(stage, names, today)),
        };
      }),
      openStageCount: stages.filter((stage) => isOpenStage(stage.status)).length,
    }),
  );
}
