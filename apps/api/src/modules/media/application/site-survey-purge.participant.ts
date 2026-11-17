/**
 * `media` as a participant of the automatic purge of a site survey (EVM-139 AC2, AC4, AC5; the port `SiteSurveyPurgeParticipant`; SR-PRIV-11, SR-FILE-11, SR-DATA-08).
 * The files of the media of the order go the way of the purge of EVM-051: in the transaction of the job (the order locked, every file `FOR UPDATE`) the active upload
 * sessions are closed, the files are marked `erased_at` (and lose the original name), the media get the marker of the purge and the soft delete (the phones receive
 * `delete`), the ZIP exports of the order end; AFTER the commit the multipart uploads are aborted and every object (original, thumbnail, preview, 720p) is removed and
 * `objects_erased_at` is written. A storage that fails there leaves `erased_at` set and `objects_erased_at` empty: `ErasureCompletionJob` finishes the removal (no orphan).
 * No name, description or key is ever returned, logged or put in the register - only the identifiers of the media.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import {
  SiteSurveyPurgeRegistry,
  type AfterCommit,
  type SiteSurveyPurgeParticipant,
  type SurveyPurgeContext,
  type SurveyPurgeIdentity,
} from '../../work-orders/index.ts';
import { closeSessionsOf, derivativeKeysOf, markFilesErased, markObjectsErased, uploadIdsOf } from '../infrastructure/erasure-store.ts';
import { expireExportsOfOrder } from '../infrastructure/export-store.ts';
import { assetIdsOfOrder, lockFilesOfOrder, purgeAssetsOfOrder, siteHeldByDocument } from '../infrastructure/survey-purge-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

@Injectable()
export class MediaSurveyPurgeParticipant implements SiteSurveyPurgeParticipant, OnModuleInit {
  readonly name = 'media';
  readonly order = 100;
  readonly #registry: SiteSurveyPurgeRegistry;
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(SiteSurveyPurgeRegistry) registry: SiteSurveyPurgeRegistry,
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#registry = registry;
    this.#db = db;
    this.#clock = clock;
    this.#storage = storage;
  }

  onModuleInit(): void {
    this.#registry.register(this);
  }

  async identify(tx: Kysely<Database>, context: SurveyPurgeContext): Promise<SurveyPurgeIdentity> {
    const tables = mediaTables(tx);
    return {
      mediaAssetIds: await assetIdsOfOrder(tables, context.workOrderId),
      holdsSite: context.siteId !== null && (await siteHeldByDocument(tables, context.siteId)),
    };
  }

  async erase(tx: Kysely<Database>, context: SurveyPurgeContext): Promise<AfterCommit | undefined> {
    const tables = mediaTables(tx);
    const files = await lockFilesOfOrder(tables, context.workOrderId);
    const fileIds = files.map((file) => file.id);
    const keys = [...files.map((file) => file.objectKey), ...(await derivativeKeysOf(tables, fileIds))];
    const uploads = await uploadIdsOf(tables, fileIds);
    await closeSessionsOf(tables, fileIds, context.now);
    await markFilesErased(tables, fileIds, context.now);
    await purgeAssetsOfOrder(tables, context.workOrderId, context.now);
    // SR-PRIV-04, SR-DATA-07: a ZIP export of the order may hold the erased photo - it ends now, the sweep of the worker removes its object
    await expireExportsOfOrder(tables, context.workOrderId);

    const storage = this.#storage;
    if (storage === null || fileIds.length === 0) return undefined;
    return async () => {
      for (const upload of uploads) {
        // best effort, as in `ErasureCompletionJob`: the key of the worker may not abort an upload, the lifecycle rule of the bucket cleans what is left
        await storage.abortMultipartUpload(upload.objectKey, upload.uploadId).catch(() => undefined);
      }
      for (const key of keys) await storage.deleteObject(key);
      await runInTransaction(this.#db, (own) => markObjectsErased(mediaTables(own), fileIds, this.#clock.now()));
    };
  }
}
