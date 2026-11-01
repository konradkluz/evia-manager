/**
 * The implementation of the port `WORK_ORDER_QUICK_CREATION` (see `system-ports.ts`; EVM-099 AC1, AC4-AC6): the quick order of the phone composed by the SAME
 * component as the panel, INSERT only, with the origin `mobile_quick` and the device of the session. The assignee is the signed-in user (the phone names none),
 * the planned date and the description stay empty. Nothing here throws a problem of the panel: the result is typed, so `sync` maps it to a verdict.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from '../../catalog/index.ts';
import { workOrderTables } from '../infrastructure/tables.ts';
import type { QuickCreationResult, QuickOrderProbe, QuickWorkOrderInput, WorkOrderQuickCreation } from '../system-ports.ts';
import { WorkOrderComposer } from './work-order-composer.ts';

@Injectable()
export class WorkOrderQuickCreationService implements WorkOrderQuickCreation {
  readonly #composer: WorkOrderComposer;
  readonly #templates: TemplateDirectory;

  constructor(@Inject(WorkOrderComposer) composer: WorkOrderComposer, @Inject(TEMPLATE_DIRECTORY) templates: TemplateDirectory) {
    this.#composer = composer;
    this.#templates = templates;
  }

  async probe(
    tx: Kysely<Database>,
    id: string,
    author: { readonly userId: string; readonly deviceId: string },
    createdBefore: Date,
  ): Promise<QuickOrderProbe> {
    const row = await workOrderTables(tx)
      .selectFrom('work_orders.work_orders')
      .select(['number', 'created_by', 'created_via_device_id', 'origin', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) return { kind: 'free' };
    const own =
      row.origin === 'mobile_quick' &&
      row.created_by === author.userId &&
      row.created_via_device_id === author.deviceId &&
      row.created_at.getTime() <= createdBefore.getTime();
    return own ? { kind: 'own', number: row.number } : { kind: 'conflict' };
  }

  async numberOf(tx: Kysely<Database>, id: string): Promise<string | undefined> {
    const row = await workOrderTables(tx).selectFrom('work_orders.work_orders').select('number').where('id', '=', id).executeTakeFirst();
    return row?.number;
  }

  async templateAvailable(tx: Kysely<Database>, templateId: string): Promise<boolean> {
    return (await this.#templates.findActiveForCopy(tx, templateId)) !== undefined;
  }

  async create(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    input: QuickWorkOrderInput,
    context: EventContext,
  ): Promise<QuickCreationResult> {
    const result = await this.#composer.compose(
      tx,
      principal,
      {
        id: input.id,
        customerId: input.customerId,
        siteId: input.siteId,
        templateId: input.templateId,
        title: input.title,
        assigneeUserId: null,
        plannedDate: null,
        description: null,
      },
      { origin: 'mobile_quick', createdViaDeviceId: deviceId },
      context,
    );
    if (result.ok) return result;
    switch (result.reason) {
      case 'composition_limit':
        return { ok: false, reason: 'template_unavailable' };
      case 'assignee_unavailable':
        // the signed-in user is not an active user any more: the guard let the request in a moment ago, so this is a race with a deactivation - no oracle, `target_unavailable`
        return { ok: false, reason: 'target_unavailable' };
      default:
        return { ok: false, reason: result.reason };
    }
  }
}
