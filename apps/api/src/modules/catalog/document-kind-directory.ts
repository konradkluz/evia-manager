/**
 * The facade of `catalog` for the documents of a work order (EVM-047 AC1-AC3; ADR-0001: a module reaches another one through its `index.ts` only).
 * `media` reads the kind of a document - its name and its class of confidentiality - in the transaction of the caller. A kind that is retired
 * (`deleted_at`) is NOT offered for a new document ({@link DocumentKindDirectory.findActiveByCode}) but is still readable for the documents that already
 * have it ({@link DocumentKindDirectory.findByCodes}): retiring a kind must never change the class of a stored document.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const DOCUMENT_KIND_DIRECTORY = Symbol('DOCUMENT_KIND_DIRECTORY');

export type DocumentKindConfidentiality = 'standard' | 'building_security' | 'identity_data';

export interface DocumentKindForDocument {
  readonly code: string;
  readonly name: string;
  readonly confidentiality: DocumentKindConfidentiality;
}

export interface DocumentKindDirectory {
  /** @returns the kind with that code; `undefined` when it does not exist or is retired (the same answer: no oracle) */
  findActiveByCode(tx: Kysely<Database>, code: string): Promise<DocumentKindForDocument | undefined>;
  /** The kinds with those codes in ONE statement, retired ones included, by code (one read per request, no N+1). */
  findByCodes(tx: Kysely<Database>, codes: readonly string[]): Promise<ReadonlyMap<string, DocumentKindForDocument>>;
}
