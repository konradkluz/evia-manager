/**
 * The reads of ONE work order for W-06 (EVM-018 AC1–AC3, AC5; SR-AUTHZ-02, SR-AUTHZ-03, SR-DATA-03, SR-LOG-02): the header, the scope,
 * the card of the customer and the card of the site. The guard has decided before this runs (three roles, web channel); here, first
 * of all, the order is resolved with the read policy IN THE QUERY (`visibleWorkOrders`) — an order that does not exist and one that is
 * deleted are the same `404 not_found`, for every role (the view of deleted orders is EVM-060). Only then the rest is read, and the
 * keys of the customer and the site come from the row of THAT order, never from the request.
 *
 * The data of other modules comes through their facades, each under its own read policy: the customer (`CustomerDirectory`), the
 * site (`SiteDirectory`), the names of the OSD and the manager in ONE batch (`PartyDirectory`), the names of the coordinators
 * (`UserDirectory`). Nothing is copied into `work_orders`. Every answer is parsed with the schema of the contract before it leaves,
 * so only the fields of the contract can leave; nothing here logs a body or a card, and a read is not an audited event (ADR-0001).
 */
import { zCustomerCard, zGetWorkOrderPath, zScopeItemList, zSiteCard, zWorkOrderDetails } from '@evia/contracts/zod';
import type { CustomerCard, ScopeItemList, SiteCard, WorkOrderDetails } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { PARTY_DIRECTORY, type PartyDirectory } from '../../parties/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import {
  findCoordinatorUserId,
  findReadableWorkOrder,
  listScopeItems,
  type ReadableWorkOrderRow,
} from '../infrastructure/work-order-store.ts';

const pathSchema = strictObjects(zGetWorkOrderPath);

const present = <K extends string>(key: K, value: string | null): { [P in K]?: string } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: string };

/** The answer is parsed with the schema of the contract; a mismatch is a defect of the server, never shown as data. */
const checked = <T>(result: { success: true; data: T } | { success: false }): T => {
  if (!result.success) throw new ProblemException('internal_error');
  return result.data;
};

@Injectable()
export class ReadWorkOrderService {
  readonly #db: Kysely<Database>;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #parties: PartyDirectory;
  readonly #users: UserDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(PARTY_DIRECTORY) parties: PartyDirectory,
    @Inject(UserDirectory) users: UserDirectory,
  ) {
    this.#db = db;
    this.#customers = customers;
    this.#sites = sites;
    this.#parties = parties;
    this.#users = users;
  }

  /** The header (AC1, AC5). @param rawParams the path parameters as parsed by the framework */
  async header(principal: Principal, rawParams: unknown): Promise<WorkOrderDetails> {
    const order = await this.#order(principal, rawParams);
    const customer = order.customer_id === null ? undefined : await this.#customers.findVisible(this.#db, principal, order.customer_id);
    const site = order.site_id === null ? undefined : await this.#sites.findVisible(this.#db, principal, order.site_id);
    const coordinatorId = await findCoordinatorUserId(workOrderTables(this.#db), order.id);
    const names = await this.#users.displayNamesOf(coordinatorId === undefined ? [] : [coordinatorId]);
    const coordinatorName = coordinatorId === undefined ? undefined : names.get(coordinatorId);
    return checked(
      zWorkOrderDetails.safeParse({
        id: order.id,
        number: order.number,
        title: order.title,
        status: order.status,
        customer: customer === undefined ? null : { id: customer.id, displayName: customer.displayName },
        site:
          site === undefined
            ? null
            : {
                id: site.id,
                siteType: site.siteType,
                street: site.street,
                buildingNumber: site.buildingNumber,
                ...present('apartmentNumber', site.apartmentNumber),
                postalCode: site.postalCode,
                city: site.city,
                ...present('parkingSpotNumber', site.parkingSpotNumber),
                ...present('garageLevel', site.garageLevel),
              },
        coordinator:
          coordinatorId === undefined || coordinatorName === undefined ? null : { id: coordinatorId, displayName: coordinatorName },
        version: order.version,
        createdAt: order.created_at.toISOString(),
      }),
    );
  }

  /** The scope (AC2, AC3): the items of THIS order only, `work_order_id` and `deleted_at` in the query itself. */
  async scopeItems(principal: Principal, rawParams: unknown): Promise<ScopeItemList> {
    const order = await this.#order(principal, rawParams);
    const items = await listScopeItems(workOrderTables(this.#db), order.id);
    return checked(
      zScopeItemList.safeParse({
        items: items.map((item) => ({
          id: item.id,
          position: item.position,
          code: item.code,
          name: item.name,
          parameterSetCode: item.parameter_set_code,
          parameters: item.parameters,
          quantity: item.quantity,
        })),
      }),
    );
  }

  /** The card "Klient" (AC1, AC5): a customer that is missing or deleted is `404` (no data of a deleted record). */
  async customerCard(principal: Principal, rawParams: unknown): Promise<CustomerCard> {
    const order = await this.#order(principal, rawParams);
    const card = order.customer_id === null ? undefined : await this.#customers.getCard(this.#db, principal, order.customer_id);
    if (card === undefined) throw new ProblemException('not_found');
    return checked(zCustomerCard.safeParse({ displayName: card.displayName, phone: card.phone, email: card.email }));
  }

  /** The card "Lokalizacja" (AC1, AC4, AC5): the OSD and the manager are named by ONE batch query to `parties`. */
  async siteCard(principal: Principal, rawParams: unknown): Promise<SiteCard> {
    const order = await this.#order(principal, rawParams);
    const card = order.site_id === null ? undefined : await this.#sites.getCard(this.#db, principal, order.site_id);
    if (card === undefined) throw new ProblemException('not_found');
    const partyIds = [card.distributionSystemOperatorPartyId, card.managerPartyId].filter((id) => id !== null);
    const names = await this.#parties.namesOf(this.#db, principal, partyIds);
    const party = (id: string | null) => {
      const displayName = id === null ? undefined : names.get(id);
      return id === null || displayName === undefined ? null : { id, displayName };
    };
    return checked(
      zSiteCard.safeParse({
        siteType: card.siteType,
        street: card.street,
        buildingNumber: card.buildingNumber,
        ...present('apartmentNumber', card.apartmentNumber),
        postalCode: card.postalCode,
        city: card.city,
        ...present('parkingSpotNumber', card.parkingSpotNumber),
        ...present('garageLevel', card.garageLevel),
        ...(card.connectionPowerKw === null ? {} : { connectionPowerKw: card.connectionPowerKw }),
        ...present('meteringPointId', card.meteringPointId),
        ...present('notes', card.notes),
        distributionSystemOperator: party(card.distributionSystemOperatorPartyId),
        manager: party(card.managerPartyId),
      }),
    );
  }

  /** @throws ProblemException `validation_failed` for a malformed id, `not_found` — one answer for a missing and a deleted order */
  async #order(principal: Principal, rawParams: unknown): Promise<ReadableWorkOrderRow> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const order = await findReadableWorkOrder(workOrderTables(this.#db), principal, workOrderId);
    if (order === undefined) throw new ProblemException('not_found');
    return order;
  }
}
