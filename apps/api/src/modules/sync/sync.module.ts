/**
 * Module `sync` (ADR-0001, ADR-0021 D8; EVM-096): the pull of changes of the mobile app - the change log (`sync.change_log`, written by the trigger of the
 * database), the cursor with a ring of keys, the state of the devices and the limit of the full downloads; owner of the `sync` schema. It reads the synchronised
 * entities through the SYNC ports of `work-orders`, `customers` and `sites` (`system-ports.ts`: a listed set of columns, the read policy and the rule of scope in
 * the query). Nothing depends on this module: the composition root registers it, and no other module imports it.
 */
import { Module } from '@nestjs/common';
import { KeyRingCursorCodec } from '../../platform/crypto/key-ring-cursor.ts';
import type { Clock } from '../../platform/clock/clock.ts';
import type { AppConfig } from '../../platform/config/config.ts';
import { APP_CONFIG, CLOCK } from '../../platform/tokens.ts';
import { CustomersModule } from '../customers/index.ts';
import { IdentityModule } from '../identity/index.ts';
import { SitesModule } from '../sites/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { SyncChangesService } from './application/sync-changes.service.ts';
import { SyncController } from './http/sync.controller.ts';
import { SYNC_CURSOR_CODEC } from './sync.tokens.ts';

@Module({
  imports: [IdentityModule, WorkOrdersModule, CustomersModule, SitesModule],
  controllers: [SyncController],
  providers: [
    SyncChangesService,
    {
      provide: SYNC_CURSOR_CODEC,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: AppConfig, clock: Clock) => new KeyRingCursorCodec(config.sync.cursorKeys, clock),
    },
  ],
})
export class SyncModule {}
