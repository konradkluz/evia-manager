/**
 * "Usuń dokumenty zlecenia o podanych `documentIds`" (EVM-147 AC5, AC7; ADR-0025 pt 4; SR-PRIV-11, SR-FILE-11, SR-DATA-08): ONE idempotent operation of `media`, shared by the
 * automatic purge of a site survey and by the replay of the register of deletions after a restore of the database (the reader of the register and its command are EVM-084).
 * It is INTERNAL - no route, no controller calls it.
 *
 * {@link SurveyDocumentPurge.erase} runs in the transaction of the caller and reaches only the documents of THAT order among the named ones (an identifier of another order is
 * ignored): every file of every version locked `FOR UPDATE`; the invariant "`change_note` is always `NULL`" checked - a note stops everything, fail closed
 * ({@link SurveyPurgeInvariantViolated}; the application role cannot clear it); the upload sessions closed, the files marked `erased_at` without their original name, the
 * documents redacted (neutral title, no description, soft deleted, `file_purged_at`, `version + 1`). AFTER the commit {@link SurveyDocumentPurge.removeObjects} aborts the
 * multipart uploads (best effort) and removes every object, then writes `objects_erased_at`; a storage that fails leaves the state `ErasureCompletionJob` finishes.
 * A second application changes nothing (every step is guarded by the state). Identifiers only - never a title, a description, a file name or a note.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { SurveyPurgeInvariantViolated } from '../../work-orders/index.ts';
import { erasureMarker } from '../domain/erasure.ts';
import { closeSessionsOf, markFilesErased, markObjectsErased, uploadIdsOf, type OpenUpload } from '../infrastructure/erasure-store.ts';
import { changeNoteViolationsOf, lockDocumentFilesOf, purgeDocumentsOfOrder } from '../infrastructure/survey-purge-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';

/** What is left for the storage after the commit. */
export interface DocumentRemoval {
  readonly fileIds: readonly string[];
  readonly keys: readonly string[];
  readonly uploads: readonly OpenUpload[];
}

@Injectable()
export class SurveyDocumentPurge {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #storage: ObjectStorage | null;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(OBJECT_STORAGE) storage: ObjectStorage | null) {
    this.#db = db;
    this.#clock = clock;
    this.#storage = storage;
  }

  /**
   * The part in the database, in the transaction of the caller.
   * @throws SurveyPurgeInvariantViolated when a version of the documents has a `change_note` - nothing is changed by this call
   */
  async erase(tx: Kysely<Database>, workOrderId: string, documentIds: readonly string[], now: Date): Promise<DocumentRemoval> {
    const tables = mediaTables(tx);
    const files = await lockDocumentFilesOf(tables, workOrderId, documentIds);
    if ((await changeNoteViolationsOf(tables, workOrderId, documentIds)) > 0)
      throw new SurveyPurgeInvariantViolated('change_note_invariant');
    const fileIds = files.map((file) => file.id);
    const uploads = await uploadIdsOf(tables, fileIds);
    await closeSessionsOf(tables, fileIds, now);
    await markFilesErased(tables, fileIds, now);
    await purgeDocumentsOfOrder(tables, workOrderId, documentIds, erasureMarker(now), now);
    return { fileIds, keys: files.map((file) => file.objectKey), uploads };
  }

  /** After the commit: the uploads aborted (best effort - the lifecycle rule of the bucket cleans what is left), every object removed, the removal recorded. */
  async removeObjects(removal: DocumentRemoval): Promise<void> {
    const storage = this.#storage;
    if (storage === null || removal.fileIds.length === 0) return;
    for (const upload of removal.uploads) await storage.abortMultipartUpload(upload.objectKey, upload.uploadId).catch(() => undefined);
    for (const key of removal.keys) await storage.deleteObject(key);
    await runInTransaction(this.#db, (own) => markObjectsErased(mediaTables(own), removal.fileIds, this.#clock.now()));
  }

  /** The whole operation in a transaction of its own (the replay of a register entry): the same path as the purge of a survey, idempotent. */
  async apply(workOrderId: string, documentIds: readonly string[]): Promise<void> {
    const removal = await runInTransaction(this.#db, (tx) => this.erase(tx, workOrderId, documentIds, this.#clock.now()));
    await this.removeObjects(removal);
  }
}
