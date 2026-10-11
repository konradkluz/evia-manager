/**
 * The facade of `catalog` for the editing of the scope of a work order (EVM-035 AC2, AC4; ADR-0001: a module reaches another one
 * through its `index.ts` only). `work-orders` COPIES an item of the service catalogue into the scope of an order (D1 — the order
 * holds a snapshot: a later change of the catalogue does not touch it), and `procedures` copies the processes the item brings with
 * their stages. The caller passes ITS transaction. An item that does not exist, is retired (`isActive = false`) or is deleted is
 * the same answer, `undefined` (no oracle): the caller answers `400 unknown_catalog_item` for all three.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { TemplateProcedureForCopy } from './template-directory.ts';

export const CATALOG_ITEM_DIRECTORY = Symbol('CATALOG_ITEM_DIRECTORY');

/** An active item of the catalogue, ready to become a scope item: the technical values only. */
export interface CatalogItemForScope {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** The set that validates the parameters of the item (`null` — the item has no parameters). */
  readonly parameterSetCode: string | null;
  /** The codes of the active processes the item brings, in order, each once. */
  readonly procedureCodes: readonly string[];
}

export interface CatalogItemDirectory {
  /** @returns the active item with that code; `undefined` when it is missing, retired or deleted */
  findActiveByCode(tx: Kysely<Database>, code: string): Promise<CatalogItemForScope | undefined>;
  /**
   * The active processes an item brings with their stages in order (the same shape as the processes of a template, so one planner
   * copies both). The caller has resolved the item with {@link findActiveByCode} in the same transaction; an unknown id gives an
   * empty list. `broughtByCatalogItemId` is the item itself.
   */
  findProcedures(tx: Kysely<Database>, catalogItemId: string): Promise<TemplateProcedureForCopy[]>;
}
