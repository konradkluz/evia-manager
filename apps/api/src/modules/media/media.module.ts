/**
 * Module `media` (ADR-0001, ADR-0009; EVM-044): the media of a work order, their files and the upload sessions; owner of the `media`
 * schema. EVM-044 serves the batch of media, the list, the multipart upload through signed URLs and the scan of the uploaded files
 * (the worker). It reaches `work-orders` only through its facade (`WorkOrderDirectory`: may THIS caller see the order?) and the storage and
 * the scanner only through the ports of `platform` (`ObjectStorage`, `MalwareScanner`) — never through the SDK. `audit` and `timeline` subscribe
 * to its events (the dependency points to `index.ts`).
 */
import { Module } from '@nestjs/common';
import { EventBus } from '../../platform/events/event-bus.ts';
import type { Kysely } from 'kysely';
import type { Clock } from '../../platform/clock/clock.ts';
import type { Database } from '../../platform/database/database.ts';
import type { Logger } from '../../platform/logging/logger.ts';
import type { MalwareScanner } from '../../platform/malware-scan/malware-scanner.ts';
import { MALWARE_SCANNER } from '../../platform/malware-scan/malware-scanner.ts';
import type { ObjectStorage } from '../../platform/object-storage/object-storage.ts';
import { OBJECT_STORAGE } from '../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../platform/tokens.ts';
import { AdministratorDirectory, IdentityModule } from '../identity/index.ts';
import { WorkOrdersModule } from '../work-orders/index.ts';
import { CreateMediaAssetsService } from './application/create-media-assets.service.ts';
import { CreateUploadSessionService } from './application/create-upload-session.service.ts';
import { FinishUploadService } from './application/finish-upload.service.ts';
import { ListMediaAssetsService } from './application/list-media-assets.service.ts';
import { AbandonedUploadsJob } from './application/abandoned-uploads.job.ts';
import { MediaScanService } from './application/media-scan.service.ts';
import { QuarantineRetentionJob } from './application/quarantine-retention.job.ts';
import { RescanMediaService } from './application/rescan-media.service.ts';
import { SignatureMonitorJob } from './application/signature-monitor.job.ts';
import { SessionAccess } from './application/session-access.ts';
import { UploadPartsService } from './application/upload-parts.service.ts';
import { MediaController } from './http/media.controller.ts';

@Module({
  imports: [WorkOrdersModule, IdentityModule],
  controllers: [MediaController],
  providers: [
    CreateMediaAssetsService,
    ListMediaAssetsService,
    CreateUploadSessionService,
    UploadPartsService,
    FinishUploadService,
    SessionAccess,
    RescanMediaService,
    QuarantineRetentionJob,
    AbandonedUploadsJob,
    SignatureMonitorJob,
    {
      provide: MediaScanService,
      inject: [DATABASE, CLOCK, EVENT_BUS, LOGGER, OBJECT_STORAGE, MALWARE_SCANNER, AdministratorDirectory],
      useFactory: (
        db: Kysely<Database>,
        clock: Clock,
        events: EventBus,
        logger: Logger,
        storage: ObjectStorage | null,
        scanner: MalwareScanner | null,
        administrators: AdministratorDirectory,
      ) => new MediaScanService({ db, clock, events, logger, storage, scanner, administrators: (tx) => administrators.listActiveIds(tx) }),
    },
  ],
  exports: [MediaScanService, QuarantineRetentionJob, AbandonedUploadsJob, SignatureMonitorJob],
})
export class MediaModule {}
