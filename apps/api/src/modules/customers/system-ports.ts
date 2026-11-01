/**
 * The SYNC port of `customers` (EVM-096; ADR-0021 D8): the projection of a customer for the phone - the display name and the telephone, NO e-mail, tax id,
 * address or notes (rodo.md: "telefon - bez e-maila i notatek"). The read policy is in the query; the columns are listed, never `*`. Not part of `index.ts`:
 * only `sync` may import it (the rule of module boundaries), so no controller can reach a read that skips the policy.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { EventContext } from '../../platform/events/event-bus.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { FieldIssue } from '../../platform/input/field-issues.ts';
import type { SyncRowState } from '../../platform/sync/sync-row-state.ts';
import type { QuickCustomerInput } from './domain/quick-customer.ts';

export const CUSTOMER_SYNC_SOURCE = Symbol('CUSTOMER_SYNC_SOURCE');

/** The fields of `SyncCustomer` (contract) that come from the customer. */
export interface SyncCustomerProjection {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly displayName: string;
  readonly phone: string;
}

export interface CustomerSyncSource {
  /**
   * The state of every customer among `ids` that exists (ONE query): `upsert` with the projection when the caller may read it, `delete` when it is soft
   * deleted. The caller (`sync`) decides, with the scope, whether a marker is due.
   */
  statesOf(
    tx: Kysely<Database>,
    principal: Principal,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, SyncRowState<SyncCustomerProjection>>>;
}

/**
 * The COMMAND port of `customers` for the quick work order of the phone (EVM-099 AC2, AC3, AC7; ADR-0008): a customer created from the fields of the command
 * (the kind, the display name, the telephone), INSERT only, with the device of the session recorded; the count of the customers a device created lately
 * (the limit of 20 in 24 hours is decided by `sync`). It runs in the transaction of `sync`. The answer is a code only - nothing of an existing row. Not part of
 * `index.ts`: only `sync` may import it, so no controller reaches a write that skips the rules of the panel.
 */
export const CUSTOMER_QUICK_CREATION = Symbol('CUSTOMER_QUICK_CREATION');

export interface CustomerQuickCreation {
  /** The rules of the content, without a write: the pointers and the codes of the errors (never values) - empty when the customer is valid. */
  check(input: QuickCustomerInput): readonly FieldIssue[];
  /** `created`; `invalid` - a rule of the content; `id_conflict` - the identifier exists (also a deleted, anonymized or foreign customer). Publishes `customer.created`. */
  create(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    input: QuickCustomerInput,
    context: EventContext,
  ): Promise<'created' | 'invalid' | 'id_conflict'>;
  /**
   * An existing customer the order may use, LOCKED `FOR KEY SHARE`: not deleted, not anonymized, visible to the caller - a missing, deleted, anonymized and invisible
   * customer are one answer, `false` (AC5). Only a yes or a no.
   */
  lockUsable(tx: Kysely<Database>, principal: Principal, id: string): Promise<boolean>;
  /** The customers this device created after `since`, deleted and anonymized ones included. */
  countCreatedBy(tx: Kysely<Database>, deviceId: string, since: Date): Promise<number>;
}
