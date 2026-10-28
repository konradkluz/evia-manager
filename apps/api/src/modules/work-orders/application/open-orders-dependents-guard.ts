/**
 * `work-orders` as the guard of the deletion and the anonymization of a customer (EVM-041 AC2; the port `CustomerDependentsGuard` of
 * `customers`; SR-AUTHZ-10, SR-ERR-01). The dependency points from here to `customers`, never back (ADR-0001). It counts the OPEN orders of
 * the customer: not deleted (a deleted order is hidden and does not block) and with a status other than `settled` and `cancelled`
 * (`CLOSED_STATUSES`). One aggregate query, no N+1; the condition `deleted_at IS NULL` and the key `customer_id` are those of the partial
 * index `work_orders_customer_created_idx`. It is called under the lock of the customer, in the transaction of the command, as a statement of
 * its own (so an order committed before the lock is counted), and answers with the NUMBER only - never a number, a title or an id of an order.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { CustomerDependentsRegistry, WORK_ORDERS_GUARD, type CustomerDependentsGuard } from '../../customers/index.ts';
import { CLOSED_STATUSES } from '../domain/work-order-status.ts';
import { workOrderTables } from '../infrastructure/tables.ts';

@Injectable()
export class OpenOrdersDependentsGuard implements CustomerDependentsGuard, OnModuleInit {
  readonly name = WORK_ORDERS_GUARD;
  readonly order = 100;
  readonly #registry: CustomerDependentsRegistry;

  constructor(@Inject(CustomerDependentsRegistry) registry: CustomerDependentsRegistry) {
    this.#registry = registry;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async countOpen(tx: Kysely<Database>, customerId: string): Promise<number> {
    const row = await workOrderTables(tx)
      .selectFrom('work_orders.work_orders')
      .select((eb) => eb.fn.countAll<string>().as('open'))
      .where('customer_id', '=', customerId)
      .where('deleted_at', 'is', null)
      .where('status', 'not in', [...CLOSED_STATUSES])
      .executeTakeFirstOrThrow();
    return Number(row.open);
  }
}
