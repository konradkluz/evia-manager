/** Public API of the `procedures` module (other modules reach it only through this file — ADR-0001). */
export { ProceduresModule } from './procedures.module.ts';
export {
  PROCEDURE_EVENT_TYPES,
  PROCEDURE_JOURNAL_EVENT_TYPES,
  type ProcedureAuditEvent,
  type ProcedureEvent,
  type ProcedureMembershipEvent,
  type ProcedureStageEvent,
  type StageFieldsChangedEvent,
  type StageJournalChangeEvent,
  type StageStatusChangedEvent,
  type StageWaitingOnChangedEvent,
} from './events.ts';
export { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from './stage-directory.ts';
