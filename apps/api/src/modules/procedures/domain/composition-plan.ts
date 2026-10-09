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
