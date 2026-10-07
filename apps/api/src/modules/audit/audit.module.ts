/**
 * Module `audit` (ADR-0001; EVM-016 AC7): owner of the `audit` schema. It subscribes to the events of the modules (today
 * `identity`) and writes each one with the transaction of the change — a failing audit write rolls the change back. It also
 * serves the read-only view of the trail for the Administrator (names of people through the `identity` facade).
 * The audited modules never import this module (rule `no-module-imports-audit` of the module boundaries check).
 */
import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { BULK_READ_EVENT_TYPES, type BulkReadEvent } from '../../platform/bulk-read/bulk-read-event.ts';
import type { Clock } from '../../platform/clock/clock.ts';
import type { EventBus } from '../../platform/events/event-bus.ts';
import { CLOCK, EVENT_BUS } from '../../platform/tokens.ts';
import { IDENTITY_EVENT_TYPES, IdentityModule, type IdentityEvent } from '../identity/index.ts';
import { AuditReadService } from './application/audit-read.service.ts';
import { toAuditRecord } from './domain/audit-record.ts';
import { AuditController } from './http/audit.controller.ts';
import { insertAuditRecord } from './infrastructure/audit-store.ts';

@Injectable()
export class AuditSubscriber implements OnModuleInit {
  readonly #events: EventBus;
  readonly #clock: Clock;

  constructor(@Inject(EVENT_BUS) events: EventBus, @Inject(CLOCK) clock: Clock) {
    this.#events = events;
    this.#clock = clock;
  }

  onModuleInit(): void {
    for (const type of IDENTITY_EVENT_TYPES) {
      this.#events.subscribe<IdentityEvent>(type, (tx, event, context) =>
        insertAuditRecord(tx, toAuditRecord(event, context, this.#clock.now())),
      );
    }
    for (const type of BULK_READ_EVENT_TYPES) {
      this.#events.subscribe<BulkReadEvent>(type, (tx, event, context) =>
        insertAuditRecord(tx, toAuditRecord(event, context, this.#clock.now())),
      );
    }
  }
}

@Module({ imports: [IdentityModule], controllers: [AuditController], providers: [AuditSubscriber, AuditReadService] })
export class AuditModule {}
