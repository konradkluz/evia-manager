/**
 * Module `audit` (ADR-0001; EVM-016 AC7): owner of the `audit` schema. It subscribes to the events of the modules (today
 * `identity`) and writes each one with the transaction of the change — a failing audit write rolls the change back.
 * The audited modules never import this module (rule `no-module-imports-audit` of the module boundaries check).
 */
import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import type { Clock } from '../../platform/clock/clock.ts';
import type { EventBus } from '../../platform/events/event-bus.ts';
import { CLOCK, EVENT_BUS } from '../../platform/tokens.ts';
import { IDENTITY_EVENT_TYPES, type IdentityEvent } from '../identity/index.ts';
import { toAuditRecord } from './domain/audit-record.ts';
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
  }
}

@Module({ providers: [AuditSubscriber] })
export class AuditModule {}
