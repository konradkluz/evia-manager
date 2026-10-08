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

export interface TemplateDirectory {
  /** @returns the template with its items when it is active; `undefined` when it is missing, retired or deleted */
  findActiveForCopy(tx: Kysely<Database>, id: string): Promise<TemplateForCopy | undefined>;
}
