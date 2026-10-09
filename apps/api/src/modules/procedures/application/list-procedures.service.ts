/**
 * The processes and stages of a work order for W-06 (EVM-031 AC2, AC4; SR-AUTHZ-02, SR-AUTHZ-05, SR-DATA-03, SR-API-02). The guard
 * has decided before this runs (three roles, web channel). First of all the order is resolved through the facade of `work-orders`,
 * i.e. with the read policy IN THE QUERY: an order that does not exist and one that is deleted are the same `404 not_found`, for
 * every role (the view of deleted orders is EVM-060). Only then the processes and stages of THAT order are read (the anchor is in
 * the condition of the query), in one snapshot, and the names of the people responsible come from `identity` in batches. The answer
 * is bounded (30 processes, 30 stages each), parsed with the schema of the contract, and has no notes; the party waited for is
 * `{id, displayName}` (names from the facade of `parties`, ONE query) and nothing else. A read
 * is not an audited event; nothing here logs a body or a name.
 */
import { zListWorkOrderProceduresPath } from '@evia/contracts/zod';
import type { ProcedureList } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { businessDate } from '../../../platform/clock/business-date.ts';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { listProcedures, listStages } from '../infrastructure/procedure-store.ts';
import { procedureTables } from '../infrastructure/tables.ts';
import { toProcedureList, responsibleIdsOf, waitingPartyIdsOf } from './procedure-representation.ts';
import { responsibleNamesOf } from './responsible-names.ts';

const pathSchema = strictObjects(zListWorkOrderProceduresPath);

@Injectable()
export class ListProceduresService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #orders: WorkOrderDirectory;
  readonly #parties: PartyDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#orders = orders;
    this.#parties = parties;
    this.#users = users;
  }

  /** @param rawParams the path parameters as parsed by the framework */
  async list(principal: Principal, rawParams: unknown): Promise<ProcedureList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    return this.#db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const tables = procedureTables(tx);
        const [procedures, stages] = [await listProcedures(tables, order.id), await listStages(tables, order.id)];
        const names = await responsibleNamesOf(this.#users, tx, responsibleIdsOf(stages));
        const partyNames = await this.#parties.namesOf(tx, principal, waitingPartyIdsOf(stages));
        return toProcedureList(procedures, stages, names, partyNames, businessDate(this.#clock.now()));
      });
  }
}
