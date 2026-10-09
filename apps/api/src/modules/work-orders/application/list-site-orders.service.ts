/**
 * "Inne zlecenia w tej lokalizacji" of the card "Lokalizacja" (EVM-036 AC5, AC6; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-08, SR-DATA-03,
 * AB-19, CWE-639). The guard has decided before this runs (three roles, web channel only: the section is not in the mobile
 * application). First of all the order the user is looking at is resolved with the read policy IN THE QUERY (`visibleWorkOrders`): one
 * that does not exist and one that is deleted are the same `404 not_found`, for every role. The `siteId` is a column of THAT row —
 * the path has no `siteId`, so nobody can ask for the orders of a site he reached by another way. The other orders are read in ONE
 * query under the same policy (list and `total`) and come back as metadata only — number, title, status, closing time —, with no
 * customer, no money, no photo and no document. The answer is parsed with the schema of the contract.
 */
import { zGetWorkOrderPath, zSiteOrders } from '@evia/contracts/zod';
import type { SiteOrders } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { listOtherOrdersOfSite } from '../infrastructure/site-orders-reader.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { findReadableWorkOrder } from '../infrastructure/work-order-store.ts';

const pathSchema = strictObjects(zGetWorkOrderPath);

@Injectable()
export class ListSiteOrdersService {
  readonly #db: Kysely<Database>;

  constructor(@Inject(DATABASE) db: Kysely<Database>) {
    this.#db = db;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async list(principal: Principal, rawParams: unknown): Promise<SiteOrders> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const tables = workOrderTables(this.#db);
    const order = await findReadableWorkOrder(tables, principal, workOrderId);
    if (order === undefined) throw new ProblemException('not_found');
    if (order.site_id === null) return { total: 0, items: [] };

    const { total, rows } = await listOtherOrdersOfSite(tables, principal, order.site_id, order.id);
    const answer = zSiteOrders.safeParse({
      total,
      items: rows.map((row) => ({
        id: row.id,
        number: row.number,
        title: row.title,
        status: row.status,
        ...(row.closed_at === null ? {} : { closedAt: row.closed_at.toISOString() }),
      })),
    });
    if (!answer.success) throw new ProblemException('internal_error');
    return answer.data;
  }
}
