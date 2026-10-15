/**
 * The processes of a new work order, planned from what the template brings (EVM-031 AC1; domain-model.md → "Kompozycja zlecenia z
 * szablonu", D1): a COPY of each process with its stages, in the order of the template, every stage `todo`. A process whose `code` comes
 * twice is not made twice — the model allows one active process per code. The positions are numbered
 * here (1, 2, 3 …), whatever the numbers of the template, so they are always unique and inside the limits of the API. An order that
 * would pass a limit is not planned at all: the planner throws, the whole creation rolls back, no data is cut off silently
 * (SR-API-02, SR-ERR-01).
 */
import { MAX_PROCEDURES_PER_ORDER, MAX_STAGES_PER_PROCEDURE } from './stage-rules.ts';

export interface TemplateStage {
  readonly sourceStageTemplateId: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly outputDocumentKindCodes: readonly string[];
}

export interface TemplateProcedure {
  readonly sourceProcedureTemplateId: string;
  readonly code: string;
  readonly name: string;
  readonly broughtByCatalogItemId: string;
  readonly stages: readonly TemplateStage[];
}

/** A scope item of the order as the composition gets it (the identifier of the copy and of the catalogue item it came from). */
export interface ScopeItemRef {
  readonly id: string;
  readonly sourceCatalogItemId: string | null;
}

export interface PlannedStage {
  readonly sourceStageTemplateId: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly outputDocumentKindCodes: readonly string[];
}

export interface PlannedProcedure {
  readonly sourceProcedureTemplateId: string;
  /** The scope item of the order that brought the process, or `null`. */
  readonly sourceScopeItemId: string | null;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly stages: readonly PlannedStage[];
}

/** The template brings more than the API allows. Its message names the limit and never a name or an identifier. */
export class CompositionLimitError extends Error {
  readonly reason: 'too_many_procedures' | 'too_many_stages';

  constructor(reason: CompositionLimitError['reason']) {
    super(`the template brings more than the limit of the API allows (${reason})`);
    this.name = 'CompositionLimitError';
    this.reason = reason;
  }
}

/** @throws {CompositionLimitError} when a limit would be passed — nothing is cut off */
export function planProcedures(brought: readonly TemplateProcedure[], scopeItems: readonly ScopeItemRef[]): PlannedProcedure[] {
  const seen = new Set<string>();
  const fresh = brought.filter((procedure) => {
    if (seen.has(procedure.code)) return false;
    seen.add(procedure.code);
    return true;
  });
  if (fresh.length > MAX_PROCEDURES_PER_ORDER) throw new CompositionLimitError('too_many_procedures');
  if (fresh.some((procedure) => procedure.stages.length > MAX_STAGES_PER_PROCEDURE)) throw new CompositionLimitError('too_many_stages');

  const scopeItemOf = new Map(
    scopeItems.flatMap((item) => (item.sourceCatalogItemId === null ? [] : [[item.sourceCatalogItemId, item.id] as const])),
  );
  return fresh.map((procedure, index): PlannedProcedure => ({
    sourceProcedureTemplateId: procedure.sourceProcedureTemplateId,
    sourceScopeItemId: scopeItemOf.get(procedure.broughtByCatalogItemId) ?? null,
    code: procedure.code,
    name: procedure.name,
    position: index + 1,
    stages: [...procedure.stages]
      .sort((a, b) => a.position - b.position)
      .map((stage, stageIndex) => ({
        sourceStageTemplateId: stage.sourceStageTemplateId,
        code: stage.code,
        name: stage.name,
        position: stageIndex + 1,
        outputDocumentKindCodes: stage.outputDocumentKindCodes,
      })),
  }));
}

export interface AddedProceduresInput {
  /** The processes the scope item brings, in order (the facade of `catalog`). */
  readonly brought: readonly TemplateProcedure[];
  /** The codes the user chose: a subset of `brought` (the service has checked it). */
  readonly requestedCodes: readonly string[];
  /** The codes of the ACTIVE processes of the order — a code is made once. */
  readonly activeCodes: readonly string[];
  /** The positions the ACTIVE processes of the order hold. */
  readonly takenPositions: readonly number[];
  /** The scope item that brings them (EVM-035 AC3: the process says which item it came with). */
  readonly scopeItemId: string;
}

/**
 * The first free positions of the processes of an order: after the highest one, and — when the end is past the limit — the lowest
 * free ones (the model keeps the positions of the ACTIVE processes unique, 1…30).
 */
function freePositions(taken: readonly number[], count: number): number[] {
  const highest = taken.reduce((max, position) => Math.max(max, position), 0);
  if (highest + count <= MAX_PROCEDURES_PER_ORDER) return Array.from({ length: count }, (_, index) => highest + index + 1);
  const used = new Set(taken);
  const free: number[] = [];
  for (let position = 1; position <= MAX_PROCEDURES_PER_ORDER && free.length < count; position += 1) {
    if (!used.has(position)) free.push(position);
  }
  return free;
}

/**
 * The processes ADDED with a scope item to an order that exists (EVM-035 AC2; domain-model.md → `ScopeItem`: "bez duplikatów po
 * `code`"): a COPY of each chosen process with its stages, every stage `todo`, in the order the item brings them. A process whose
 * code is ALREADY active in the order is skipped, not an error — two users adding items at once must not fail each other, and the
 * model allows one active process per code. An order that would pass a limit is not planned at all: the planner throws, the
 * command rolls back, no data is cut off silently (SR-API-02).
 *
 * @throws {CompositionLimitError} when 30 processes (or 30 stages of a process) would be passed
 */
export function planAddedProcedures(input: AddedProceduresInput): PlannedProcedure[] {
  const chosen = new Set(input.requestedCodes);
  const active = new Set(input.activeCodes);
  const fresh = input.brought.filter((procedure) => {
    if (!chosen.has(procedure.code) || active.has(procedure.code)) return false;
    active.add(procedure.code);
    return true;
  });
  if (input.activeCodes.length + fresh.length > MAX_PROCEDURES_PER_ORDER) throw new CompositionLimitError('too_many_procedures');
  if (fresh.some((procedure) => procedure.stages.length > MAX_STAGES_PER_PROCEDURE)) throw new CompositionLimitError('too_many_stages');

  const positions = freePositions(input.takenPositions, fresh.length);
  // the active positions are unique within 1…30, so there are as many free ones as processes — unless the positions the caller
  // read do not agree with its codes; then nothing is planned (a number that is not free would fail the unique index)
  if (positions.length < fresh.length) throw new CompositionLimitError('too_many_procedures');
  return fresh.map((procedure, index): PlannedProcedure => copyOf(procedure, positions[index] as number, input.scopeItemId));
}

/** A COPY of a process template with its stages in order, numbered 1…n (every stage is `todo`: the server decides it). */
function copyOf(procedure: ProcedureToCopy, position: number, sourceScopeItemId: string | null): PlannedProcedure {
  return {
    sourceProcedureTemplateId: procedure.sourceProcedureTemplateId,
    sourceScopeItemId,
    code: procedure.code,
    name: procedure.name,
    position,
    stages: [...procedure.stages]
      .sort((a, b) => a.position - b.position)
      .map((stage, stageIndex) => ({
        sourceStageTemplateId: stage.sourceStageTemplateId,
        code: stage.code,
        name: stage.name,
        position: stageIndex + 1,
        outputDocumentKindCodes: stage.outputDocumentKindCodes,
      })),
  };
}

/** A process template as the copy needs it (the catalogue item that brought it is of no interest to a process added by hand). */
export type ProcedureToCopy = Omit<TemplateProcedure, 'broughtByCatalogItemId'>;

/**
 * The process ADDED BY HAND (EVM-042 AC1; domain-model.md → `Procedure`): a COPY of the template at `position`, every stage `todo`,
 * brought by no scope item. The caller has checked that the code is not active yet and that the order has room for one more process.
 *
 * @throws {CompositionLimitError} when the template brings more than 30 stages — nothing is cut off
 */
export function planProcedureCopy(template: ProcedureToCopy, position: number): PlannedProcedure {
  if (template.stages.length > MAX_STAGES_PER_PROCEDURE) throw new CompositionLimitError('too_many_stages');
  return copyOf(template, position, null);
}
