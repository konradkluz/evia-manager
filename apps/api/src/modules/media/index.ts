/** Public API of the `media` module (other modules reach it only through this file — ADR-0001). */
export { MediaModule } from './media.module.ts';
export { MediaScanService } from './application/media-scan.service.ts';
export { MediaProcessingService } from './application/media-processing.service.ts';
export { QuarantineRetentionJob } from './application/quarantine-retention.job.ts';
export { AbandonedUploadsJob } from './application/abandoned-uploads.job.ts';
export { SignatureMonitorJob } from './application/signature-monitor.job.ts';
export { MEDIA_EVENT_TYPES, MEDIA_JOURNAL_EVENT_TYPES, type MediaAssetsAddedEvent, type MediaAuditEvent } from './events.ts';
