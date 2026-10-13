/**
 * The milestones of an order for W-06 "Płatności" (EVM-053 AC2, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03; P6). The guard has decided
 * before this runs (three roles, web channel only — P3). First of all the order is resolved through the facade of `work-orders`, i.e.
 * with the read policy IN THE QUERY: an order that does not exist and one that is deleted are the same `404 not_found` for every role.
 * Then ONE query reads the milestones of THAT order (the anchor in its condition, at most 20) and the totals are computed from the same
 * rows — no second query, no filtering after the read. A read is not an audited event; nothing here logs a name or an amount.
 */
import { zListPaymentMilestonesPath } from '@evia/contracts/zod';
import type { PaymentMilestoneList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { listMilestones } from '../infrastructure/milestone-reader.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import { toPaymentMilestoneList } from './milestone-representation.ts';

const pathSchema = strictObjects(zListPaymentMilestonesPath);

@Injectable()
export class ListMilestonesService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #orders: WorkOrderDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#orders = orders;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async list(principal: Principal, rawParams: unknown): Promise<PaymentMilestoneList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const rows = await listMilestones(paymentTables(tx), order.id);
      return toPaymentMilestoneList(rows, businessDate(this.#clock.now()));
    });
  }
}
