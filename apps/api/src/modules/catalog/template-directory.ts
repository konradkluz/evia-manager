/**
 * The facade of `catalog` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `work-orders`, which COPIES the items of an active work order template into the scope of a new order (EVM-022 AC1,
 * AC2, D1 — the order holds a snapshot, a later change of the template does not touch it). The caller passes ITS transaction.
 * A template that does not exist, is retired (`isActive = false`) or is deleted is the same answer, `undefined` (no oracle):
 * the caller answers `422 template_unavailable` for all three.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const TEMPLATE_DIRECTORY = Symbol('TEMPLATE_DIRECTORY');

/** One item of a template, ready to become a scope item: the technical values only (no person, no point of supply). */
export interface TemplateScopeItem {
  readonly catalogItemId: string;
  readonly position: number;
  readonly code: string;
  readonly name: string;
  readonly parameterSetCode: string | null;
  readonly quantity: number;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export interface TemplateForCopy {
  readonly id: string;
  readonly name: string;
  /** In the order of the template (`position`). */
  readonly items: readonly TemplateScopeItem[];
}

/** One stage of a process template, ready to become a stage of an order (the copy: code, name, position; `source…Id` says where from). */
export interface TemplateStageForCopy {
  readonly sourceStageTemplateId: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly outputDocumentKindCodes: readonly string[];
}

/** One process a template brings, with its stages in order (EVM-031: the processes of a new work order). */
export interface TemplateProcedureForCopy {
  readonly sourceProcedureTemplateId: string;
  readonly code: string;
  readonly name: string;
  /** The catalogue item (of the template) that brings the process — the first one, when several do. */
  readonly broughtByCatalogItemId: string;
  readonly stages: readonly TemplateStageForCopy[];
}

export interface TemplateDirectory {
  /** @returns the template with its items when it is active; `undefined` when it is missing, retired or deleted */
  findActiveForCopy(tx: Kysely<Database>, id: string): Promise<TemplateForCopy | undefined>;
  /**
   * The processes the items of a template bring, each once and in order of first appearance, with their stages (EVM-031 AC1). The
   * caller has resolved the template with {@link findActiveForCopy} in the same transaction; an unknown id gives an empty list.
   */
  findProceduresForCopy(tx: Kysely<Database>, templateId: string): Promise<TemplateProcedureForCopy[]>;
}
