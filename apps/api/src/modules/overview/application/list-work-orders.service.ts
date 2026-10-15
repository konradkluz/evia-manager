/**
 * The list of work orders (EVM-017; W-10), read from the projection of `overview` (ADR-0017). The guard has decided before this runs
 * (the three roles, web channel); here: the validated query, the opaque cursor and the mass-read check of policy P10, then ONE page
 * through {@link WorkOrderPageService} — the same page the search (EVM-072) builds, so the two cannot disagree about what an item is.
 *
 * Order matters: the query is validated and the cursor opened (400), then a payment view is refused to a caller who may not read
 * payments (403, EVM-056 W4), BEFORE the meter is asked (429); the records returned are counted AFTER the answer is built, so a
 * refused or failed request counts nothing.
 */
import type { WorkOrderList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { BulkReadControl } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { parseInput } from '../../../platform/http/validation.ts';
import { BULK_READ_CONTROL } from '../../../platform/tokens.ts';
import { filterPartsOf, resolveWorkOrderListQuery } from '../domain/work-order-list-query.ts';
import { WorkOrderPageService } from './work-order-page.service.ts';

/** Identifier of the operation in the contract; the cursor is bound to it. */
export const LIST_WORK_ORDERS_OPERATION = 'listWorkOrders';

@Injectable()
export class ListWorkOrdersService {
  readonly #pages: WorkOrderPageService;
  readonly #bulkRead: BulkReadControl;

  constructor(@Inject(WorkOrderPageService) pages: WorkOrderPageService, @Inject(BULK_READ_CONTROL) bulkRead: BulkReadControl) {
    this.#pages = pages;
    this.#bulkRead = bulkRead;
  }

  /** @param rawQuery the query string as parsed by the framework (strings only) */
  async list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<WorkOrderList> {
    const query = parseInput(resolveWorkOrderListQuery, rawQuery);
    const scope = this.#pages.scope(principal, filterPartsOf(query));
    const start = this.#pages.start(principal, LIST_WORK_ORDERS_OPERATION, query, scope);
    this.#pages.authorize(principal, query);
    await this.#bulkRead.before(principal.userId, { ...context, sessionId: principal.sessionId });
    return this.#pages.page(principal, { operation: LIST_WORK_ORDERS_OPERATION, query, scope, start, narrowing: undefined, context });
  }
}
