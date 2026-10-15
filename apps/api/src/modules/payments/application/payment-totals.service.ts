/** The implementation of the facade `PaymentTotalsDirectory` (see `../payment-totals.ts`): the right to read payments, then ONE query. */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { PAYMENT_READ_POLICY, type PaymentReadPolicy } from '../../authorization/index.ts';
import { invoicedTotalsOf } from '../infrastructure/totals-reader.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { MAX_TOTALS_IDS, type PaymentTotals, type PaymentTotalsDirectory } from '../payment-totals.ts';

@Injectable()
export class PaymentTotalsDirectoryService implements PaymentTotalsDirectory {
  readonly #canReadPayments: PaymentReadPolicy;

  constructor(@Inject(PAYMENT_READ_POLICY) canReadPayments: PaymentReadPolicy) {
    this.#canReadPayments = canReadPayments;
  }

  async paymentTotalsOf(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderIds: readonly string[],
    today: string,
  ): Promise<ReadonlyMap<string, PaymentTotals>> {
    if (!this.#canReadPayments(principal)) return new Map();
    const ids = [...new Set(workOrderIds)];
    if (ids.length === 0) return new Map();
    if (ids.length > MAX_TOTALS_IDS) throw new Error('the totals of payments are asked for more orders than a page holds');
    return invoicedTotalsOf(paymentTables(tx), ids, today);
  }
}
