/**
 * The ONE path that composes a work order from a template (EVM-022 AC1-AC7 for the panel; EVM-099 AC1 for the phone; SR-AUTHZ-02, SR-API-06). The panel
 * (`CreateWorkOrderService`) and the quick order of the phone (`WorkOrderQuickCreationService`, a system port for `sync`) both call it, so a template is
 * copied by the same code, in the same fixed order of the contributors, whatever the channel.
 *
 * It runs in the transaction of the caller and answers with a TYPED result instead of throwing the problems of the panel, so the caller maps it to its own
 * language (a problem for the panel, a verdict for the phone) and never has to catch `ProblemException` in general:
 *   1. the customer is LOCKED `FOR KEY SHARE` through the facade (a deletion or an anonymization is serialised with this creation, EVM-041 D7) and the site is
 *      read through its facade - the same for an object that existed before and for one inserted a moment ago in this transaction;
 *      a missing, deleted or invisible one is `target_unavailable`;
 *   2. the template: an active one, else `template_unavailable`;
 *   3. the assignee: an ACTIVE user (by default the signed-in one);
 *   4. the number from the yearly counter - as late as possible, so the lock of the counter row is short - and the INSERT with the origin and the device;
 *      an existing identifier is `id_conflict` (INSERT only, `ON CONFLICT DO NOTHING`);
 *   5. the scope copied from the template, the coordinator, the contributors, the event `work_order.created` (identifiers only).
 * A contributor that reports a limit of the template (`CompositionRejectedError`) is `composition_limit`: the caller decides (the panel keeps its 500, the
 * phone says `template_unavailable`). Any other error escapes. The number is NOT used when the caller rolls back - which it always does for a result
 * other than `ok`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory, type TemplateForCopy } from '../../catalog/index.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { UserDirectory } from '../../identity/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { CompositionRejectedError, WorkOrderCompositionRegistry } from '../composition-contributor.ts';
import { resolveTitle, type NewWorkOrder } from '../domain/new-work-order.ts';
import { businessYear, formatWorkOrderNumber } from '../domain/work-order-number.ts';
import type { WorkOrderEvent } from '../events.ts';
import { takeNextNumber } from '../infrastructure/number-counter.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import { insertCoordinator, insertScopeItems, insertWorkOrder } from '../infrastructure/work-order-store.ts';

/** Where an order comes from: the panel (`office`, no device) or the phone (`mobile_quick`, the device of the session). */
export type ComposeOrigin =
  | { readonly origin: 'office'; readonly createdViaDeviceId: null }
  | { readonly origin: 'mobile_quick'; readonly createdViaDeviceId: string };

export type ComposeFailure =
  | { readonly ok: false; readonly reason: 'id_conflict' | 'template_unavailable' | 'target_unavailable' | 'composition_limit' }
  /** `named`: the request named the user (the panel answers `400 assignee_unavailable`); else the signed-in user is not active (`403`). */
  | { readonly ok: false; readonly reason: 'assignee_unavailable'; readonly named: boolean };

export type ComposeResult = { readonly ok: true; readonly number: string } | ComposeFailure;

@Injectable()
export class WorkOrderComposer {
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #customers: CustomerDirectory;
  readonly #sites: SiteDirectory;
  readonly #templates: TemplateDirectory;
  readonly #users: UserDirectory;
  readonly #contributors: WorkOrderCompositionRegistry;

  constructor(
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(TEMPLATE_DIRECTORY) templates: TemplateDirectory,
    @Inject(UserDirectory) users: UserDirectory,
    @Inject(WorkOrderCompositionRegistry) contributors: WorkOrderCompositionRegistry,
  ) {
    this.#clock = clock;
    this.#events = events;
    this.#customers = customers;
    this.#sites = sites;
    this.#templates = templates;
    this.#users = users;
    this.#contributors = contributors;
  }

  async compose(
    tx: Kysely<Database>,
    principal: Principal,
    order: NewWorkOrder,
    source: ComposeOrigin,
    context: EventContext,
  ): Promise<ComposeResult> {
    const customer = await this.#customers.lockVisible(tx, principal, order.customerId);
    const site = await this.#sites.findVisible(tx, principal, order.siteId);
    if (customer === undefined || site === undefined) return { ok: false, reason: 'target_unavailable' };
    const template = order.templateId === null ? null : await this.#templates.findActiveForCopy(tx, order.templateId);
    if (template === undefined) return { ok: false, reason: 'template_unavailable' };
    const assignee = await this.#users.findActive(order.assigneeUserId ?? principal.userId, tx);
    if (assignee === undefined) return { ok: false, reason: 'assignee_unavailable', named: order.assigneeUserId !== null };

    const now = this.#clock.now();
    const tables = workOrderTables(tx);
    const sequence = await takeNextNumber(tables, businessYear(now));
    const number = formatWorkOrderNumber(businessYear(now), sequence);
    const inserted = await insertWorkOrder(
      tables,
      {
        id: order.id,
        number,
        title: resolveTitle(order.title, template?.name ?? null),
        customerId: customer.id,
        siteId: site.id,
        sourceTemplateId: template?.id ?? null,
        plannedDate: order.plannedDate,
        description: order.description,
        origin: source.origin,
        createdViaDeviceId: source.createdViaDeviceId,
      },
      principal.userId,
      now,
    );
    if (inserted === undefined) return { ok: false, reason: 'id_conflict' };

    const scope = await insertScopeItems(tables, order.id, template?.items ?? [], principal.userId, now);
    await insertCoordinator(tables, order.id, assignee.id, principal.userId, now);
    try {
      await this.#contribute(tx, principal, order.id, template, scope, now);
    } catch (error) {
      if (error instanceof CompositionRejectedError) return { ok: false, reason: 'composition_limit' };
      throw error;
    }

    const event: WorkOrderEvent = {
      type: 'work_order.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'work_order',
      objectId: order.id,
    };
    await this.#events.publish(tx, event, context);
    return { ok: true, number };
  }

  async #contribute(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    template: TemplateForCopy | null,
    scope: Awaited<ReturnType<typeof insertScopeItems>>,
    now: Date,
  ): Promise<void> {
    for (const contributor of this.#contributors.ordered()) {
      await contributor.contribute(tx, {
        workOrderId,
        templateId: template?.id ?? null,
        scopeItems: scope.map((item) => ({
          id: item.id,
          sourceCatalogItemId: item.source_catalog_item_id,
          position: item.position,
          code: item.code,
        })),
        principal,
        now,
      });
    }
  }
}
