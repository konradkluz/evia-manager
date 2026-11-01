/** The implementation of the port `SITE_QUICK_CREATION` (see `system-ports.ts`; EVM-099): the rules of the panel, INSERT only, the device of the session recorded. */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { CLOCK, EVENT_BUS } from '../../../platform/tokens.ts';
import { normalizeQuickSite, type QuickSiteInput } from '../domain/quick-site.ts';
import type { SiteEvent } from '../events.ts';
import { countSitesCreatedBy, insertSite } from '../infrastructure/site-store.ts';
import { siteTables } from '../infrastructure/tables.ts';
import type { SiteQuickCreation } from '../system-ports.ts';

@Injectable()
export class SiteQuickCreationService implements SiteQuickCreation {
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#clock = clock;
    this.#events = events;
  }

  check(input: QuickSiteInput): readonly FieldIssue[] {
    const normalized = normalizeQuickSite(input);
    return normalized.ok ? [] : normalized.errors;
  }

  async create(
    tx: Kysely<Database>,
    principal: Principal,
    deviceId: string,
    input: QuickSiteInput,
    context: EventContext,
  ): Promise<'created' | 'invalid' | 'id_conflict'> {
    const normalized = normalizeQuickSite(input);
    if (!normalized.ok) return 'invalid';
    const row = await insertSite(siteTables(tx), normalized.site, principal.userId, this.#clock.now(), deviceId);
    if (row === undefined) return 'id_conflict';
    const event: SiteEvent = {
      type: 'site.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'site',
      objectId: row.id,
    };
    await this.#events.publish(tx, event, context);
    return 'created';
  }

  countCreatedBy(tx: Kysely<Database>, deviceId: string, since: Date): Promise<number> {
    return countSitesCreatedBy(siteTables(tx), deviceId, since);
  }
}
