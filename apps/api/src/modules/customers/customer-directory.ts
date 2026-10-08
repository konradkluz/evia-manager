/**
 * The facade of `customers` for the other modules (ADR-0001: a module reaches another one through its `index.ts` only). Its first
 * consumer is `work-orders`, which must know that the customer of a new order exists and is visible to the caller (EVM-022 AC3,
 * SR-AUTHZ-02). The caller passes ITS transaction, so the check and the insert that depends on it are one unit of work; the read
 * policy of customers applies to EVERY role, the Administrator included: a customer who is deleted is as unknown as one who never
 * existed — no oracle, T6. Only what the caller needs comes back: the identifier and the display name (SR-DATA-03).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';

export const CUSTOMER_DIRECTORY = Symbol('CUSTOMER_DIRECTORY');

export interface CustomerSummary {
  readonly id: string;
  readonly displayName: string;
}

/** The card "Klient" of a work order (EVM-018): the name, the telephone and the e-mail — nothing else (SR-DATA-03). */
export interface CustomerCard {
  readonly displayName: string;
  readonly phone: string;
  readonly email: string | null;
}

export interface CustomerDirectory {
  /** @returns the customer when it exists and is visible to the caller; `undefined` otherwise (the same for both) */
  findVisible(tx: Kysely<Database>, principal: Principal, id: string): Promise<CustomerSummary | undefined>;
  /** @returns the card of the customer when it exists and is visible to the caller; `undefined` otherwise (the same for both) */
  getCard(tx: Kysely<Database>, principal: Principal, id: string): Promise<CustomerCard | undefined>;
}
