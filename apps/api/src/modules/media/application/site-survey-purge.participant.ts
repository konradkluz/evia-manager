/**
 * `media` as a participant of the automatic purge of a site survey (EVM-139 AC2, AC4, AC5; the port `SiteSurveyPurgeParticipant`; SR-PRIV-11, SR-FILE-11, SR-DATA-08).
 * The files of the media of the order go the way of the purge of EVM-051: in the transaction of the job (the order locked, every file `FOR UPDATE`) the active upload
 * sessions are closed, the files are marked `erased_at` (and lose the original name), the media get the marker of the purge and the soft delete (the phones receive
 * `delete`), the ZIP exports of the order end; AFTER the commit the multipart uploads are aborted and every object (original, thumbnail, preview, 720p) is removed and
 * `objects_erased_at` is written. A storage that fails there leaves `erased_at` set and `objects_erased_at` empty: `ErasureCompletionJob` finishes the removal (no orphan).
 * The documents of the order (EVM-147 AC5, AC6; ADR-0025 pt 4) go the same way through {@link SurveyDocumentPurge} - the operation the replay of the register shares: the rows
 * of the documents locked `FOR UPDATE` and compared with the register (a document committed meanwhile is `SurveyChangedDuringPurge`), the files of every version erased,
 * the documents redacted and soft deleted; a `change_note` that is not `NULL` stops the whole survey, fail closed (`SurveyPurgeInvariantViolated`).
 * No name, title, description or key is ever returned, logged or put in the register - only the identifiers of the media and the documents.
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
  SurveyChangedDuringPurge,
  type SiteSurveyPurgeParticipant,
  type SurveyEraseContext,
  type SurveyPurgeContext,
  type SurveyPurgeIdentity,
  type SurveyPurgeReport,
} from '../../work-orders/index.ts';
import { closeSessionsOf, derivativeKeysOf, markFilesErased, markObjectsErased, uploadIdsOf } from '../infrastructure/erasure-store.ts';
import { expireExportsOfOrder } from '../infrastructure/export-store.ts';
import {
  assetIdsOfOrder,
  documentIdsOfOrder,
  documentReportOf,
  lockDocumentsOfOrder,
  lockFilesOfOrder,
  purgeAssetsOfOrder,
  siteHeldByDocument,
} from '../infrastructure/survey-purge-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { SurveyDocumentPurge } from './survey-document-purge.ts';

@Injectable()
export class MediaSurveyPurgeParticipant implements SiteSurveyPurgeParticipant, OnModuleInit {
  readonly name = 'media';
  readonly order = 100;
  readonly #registry: SiteSurveyPurgeRegistry;
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #storage: ObjectStorage | null;
  readonly #documents: SurveyDocumentPurge;

  constructor(
    @Inject(SiteSurveyPurgeRegistry) registry: SiteSurveyPurgeRegistry,
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(SurveyDocumentPurge) documents: SurveyDocumentPurge,
  ) {
    this.#documents = documents;
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
      documentIds: await documentIdsOfOrder(tables, context.workOrderId),
      holdsSite: context.siteId !== null && (await siteHeldByDocument(tables, context.siteId)),
    };
  }

  async erase(tx: Kysely<Database>, context: SurveyEraseContext): Promise<AfterCommit | undefined> {
    const tables = mediaTables(tx);
    // SR-FILE-11: a medium committed while the register was written is not in the register - the survey waits for the next run (the row lock of the order does not stop an insert)
    const declared = new Set(context.declaredMediaAssetIds);
    const current = await assetIdsOfOrder(tables, context.workOrderId);
    if (current.some((id) => !declared.has(id))) throw new SurveyChangedDuringPurge();
    // ADR-0025 pt 4: the same for the documents - their rows locked first (a change, a deletion or an erasure waits), a document outside the register stops the survey
    const declaredDocuments = new Set(context.declaredDocumentIds);
    const documentIds = await lockDocumentsOfOrder(tables, context.workOrderId);
    if (documentIds.some((id) => !declaredDocuments.has(id))) throw new SurveyChangedDuringPurge();
    // the documents FIRST: a broken invariant of `change_note` throws before any change (the transaction rolls back either way)
    const documents = await this.#documents.erase(tx, context.workOrderId, documentIds, context.now);
    const files = await lockFilesOfOrder(tables, context.workOrderId);
    const fileIds = files.map((file) => file.id);
    const keys = [...files.map((file) => file.objectKey), ...(await derivativeKeysOf(tables, fileIds))];
    const uploads = await uploadIdsOf(tables, fileIds);
    await closeSessionsOf(tables, fileIds, context.now);
    await markFilesErased(tables, fileIds, context.now);
    await purgeAssetsOfOrder(tables, context.workOrderId, current, context.now);
    // SR-PRIV-04, SR-DATA-07: a ZIP export of the order may hold the erased photo - it ends now, the sweep of the worker removes its object
    await expireExportsOfOrder(tables, context.workOrderId);

    const storage = this.#storage;
    if (storage === null || (fileIds.length === 0 && documents.fileIds.length === 0)) return undefined;
    return async () => {
      await this.#documents.removeObjects(documents);
      for (const upload of uploads) {
        // best effort, as in `ErasureCompletionJob`: the key of the worker may not abort an upload, the lifecycle rule of the bucket cleans what is left
        await storage.abortMultipartUpload(upload.objectKey, upload.uploadId).catch(() => undefined);
      }
      for (const key of keys) await storage.deleteObject(key);
      await runInTransaction(this.#db, (own) => markObjectsErased(mediaTables(own), fileIds, this.#clock.now()));
    };
  }

  /** The mode `report` (EVM-147): the documents of the candidates and the versions that break the invariant of `change_note` - counts only. */
  report(db: Kysely<Database>, workOrderIds: readonly string[]): Promise<SurveyPurgeReport> {
    return documentReportOf(mediaTables(db), workOrderIds);
  }
}
