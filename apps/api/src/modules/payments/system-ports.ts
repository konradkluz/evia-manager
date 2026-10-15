/**
 * The SYSTEM port of `payments` for the read model (ADR-0017 W5; EVM-056; P4): the status and the due date of the live milestones of
 * the orders — no amount, no name, no invoice, no reason (W1). Not part of `index.ts`: only the application and infrastructure layers of
 * `overview` may import it (a rule of dependency-cruiser), it takes no principal and applies no read policy (the recomputation is the
 * same for every role and for `rebuild`, T8). Deleted and cancelled milestones are never returned (W3).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { PaymentMilestoneStatus } from './domain/money.ts';

export const PAYMENT_PROJECTION_SOURCE = Symbol('PAYMENT_PROJECTION_SOURCE');

export interface MilestoneSignalRow {
  readonly workOrderId: string;
  readonly status: Exclude<PaymentMilestoneStatus, 'cancelled'>;
  /** `YYYY-MM-DD` (an issued or a paid milestone always has one; a planned one has none) */
  readonly dueDate: string | null;
}

export interface PaymentProjectionSource {
  /** The live milestones that are not cancelled of the orders among `workOrderIds` (ONE query, whatever their number). */
  milestoneSignalsOf(tx: Kysely<Database>, workOrderIds: readonly string[]): Promise<readonly MilestoneSignalRow[]>;
}
