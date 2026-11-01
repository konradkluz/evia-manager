/**
 * The deletion of a medium or a document, its restore and the erasure of its files (EVM-051 AC1-AC4, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-PRIV-03, SR-PRIV-04,
 * SR-DATA-08, SR-LOG-03, SR-SESS-08, SR-ERR-01; CWE-639, CWE-459). The guard has decided before this runs: a signed-in ADMINISTRATOR on the web channel with a
 * valid CSRF token - and, for the erasure, a passkey authentication in the last 15 minutes (`step_up_required`, after the role: the Editor and Read-only get
 * `403 forbidden` and a mobile token `403`, whatever the object).
 *
 * The same six operations serve the media and the documents; what differs (how the subject is found and locked, where its files are, the codes) is a
 * {@link Kind}. ONE transaction each, in this order:
 *   - SOFT DELETE / RESTORE: the order through the read policy (`404`); the subject of THIS order - a document through the scope of the order, so the documents
 *     of its site and customer count while those are visible - under a row lock, also a deleted one (`404`: another order's, a document used as a medium, a
 *     missing one); delete of a deleted one is `404` (it is absent for everybody), restore of a live one `409 invalid_state_transition`, restore after the
 *     erasure `409 file_erased` (D3); the update and the audit event (identifiers only).
 *   - ERASURE OF THE FILES: the same lookup and lock (`404`); a repeat after the erasure is a success that only finishes the removal of the objects; `If-Match`
 *     (`428` / `400`) and the version (`412`); a file the scan or the processing holds right now is `409 file_processing` + `Retry-After`, nothing changes (D2);
 *     THEN the entry in the register of deletions (identifiers, code, owner, actor, time - never a name or a text; unavailable = `503
 *     deletion_register_unavailable`, the rows and the objects untouched); THEN the rows (every file of the subject locked `FOR UPDATE`, the sessions closed, the
 *     files marked `erased_at` and stripped of the original name, the marker, the description and - for a document - the title redacted, `version + 1`) and the
 *     audit event; COMMIT; THEN the multipart uploads are aborted and every object (original, thumbnail, preview, 720p; the quarantined ones too) is removed. A
 *     storage that fails after the commit leaves `objects_erased_at` empty: the answer is `503 media_storage_unavailable`, the repeat of the request and the
 *     job of the worker finish the removal (no orphaned derivative). A worker takes no file with `erased_at`, so nothing is written for it afterwards.
 * The register is a journal of INTENT with at-least-once semantics (see `RedactEntryService`); when it refuses, the audit record with the outcome `failed` is
 * written in a transaction of its own. No name, title or description is ever in the register, the audit trail, a log, a problem or an error.
 */
import {
  zDeleteDocumentPath,
  zDeleteMediaAssetPath,
  zPurgeDocumentFilePath,
  zPurgeMediaAssetFilePath,
  zRestoreDocumentPath,
  zRestoreMediaAssetPath,
} from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import {
  DELETION_REGISTER,
  DeletionRegisterUnavailable,
  type DeletionOperationCode,
  type DeletionRecord,
  type DeletionRegister,
  type DeletionSubjectType,
} from '../../../platform/deletion-register/deletion-register.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS, LOGGER } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { erasureMarker, FILE_PROCESSING_RETRY_SECONDS, isBeingProcessed } from '../domain/erasure.ts';
import type { MediaAuditEvent } from '../events.ts';
import { lockDocumentInScope } from '../infrastructure/document-store.ts';
import {
  derivativeKeysOf,
  closeSessionsOf,
  lockAssetForErasure,
  lockFilesOfAsset,
  lockFilesOfDocument,
  markAssetPurged,
  markDocumentPurged,
  markFilesErased,
  markObjectsErased,
  setAssetDeleted,
  setDocumentDeleted,
  uploadIdsOf,
  type FileToErase,
  type OpenUpload,
} from '../infrastructure/erasure-store.ts';
import { mediaTables, type MediaDb } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { requireStorage, viaStorage } from './media-support.ts';

type Operation = 'delete' | 'restore' | 'purge';

/** What the use case needs to know about the subject it locked. */
interface Subject {
  readonly id: string;
  readonly version: number;
  readonly deleted: boolean;
  readonly erased: boolean;
  /** The owner for the register: the order, or - a document of a site or a customer has no order - the anchor. */
  readonly owner: Pick<DeletionRecord, 'workOrderId' | 'anchor'>;
}

interface Kind {
  readonly objectType: 'media_asset' | 'document';
  readonly paths: Readonly<Record<Operation, { parse: (raw: unknown) => { workOrderId: string; id: string } }>>;
  readonly register: { readonly code: DeletionOperationCode; readonly subjectType: DeletionSubjectType };
  readonly events: Readonly<Record<Operation, MediaAuditEvent['type']>>;
  /** The order through the read policy and the subject of THAT order under a row lock (a deleted one too); `undefined` = `404`. */
  find(tx: Kysely<Database>, principal: Principal, workOrderId: string, id: string): Promise<Subject | undefined>;
  setDeleted(db: MediaDb, id: string, userId: string, deleted: boolean, now: Date): Promise<boolean>;
  lockFiles(db: MediaDb, id: string): Promise<FileToErase[]>;
  markPurged(db: MediaDb, id: string, userId: string, now: Date): Promise<void>;
}

function pathOf(schema: z.ZodType, idKey: string) {
  const strict = strictObjects(schema);
  return {
    parse: (raw: unknown) => {
      const parsed = parseInput(strict, raw) as Record<string, string>;
      return { workOrderId: parsed['workOrderId'] as string, id: parsed[idKey] as string };
    },
  };
}

/** The files an erasure removes, as the transaction found them. */
interface Removal {
  readonly fileIds: readonly string[];
  readonly keys: readonly string[];
  readonly uploads: readonly OpenUpload[];
}

@Injectable()
export class MediaErasureService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #register: DeletionRegister;
  readonly #storage: ObjectStorage | null;
  readonly #logger: Logger;
  readonly #media: Kind;
  readonly #documents: Kind;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DELETION_REGISTER) register: DeletionRegister,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(DocumentScopes) scopes: DocumentScopes,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#register = register;
    this.#storage = storage;
    this.#logger = logger;
    this.#media = {
      objectType: 'media_asset',
      paths: {
        delete: pathOf(zDeleteMediaAssetPath, 'mediaAssetId'),
        restore: pathOf(zRestoreMediaAssetPath, 'mediaAssetId'),
        purge: pathOf(zPurgeMediaAssetFilePath, 'mediaAssetId'),
      },
      register: { code: 'media_file_purged', subjectType: 'media_asset' },
      events: { delete: 'media_asset.deleted', restore: 'media_asset.restored', purge: 'media_asset.file_purged' },
      async find(tx, principal, workOrderId, id) {
        const order = await orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) return undefined;
        const asset = await lockAssetForErasure(mediaTables(tx), order.id, id);
        return asset === undefined
          ? undefined
          : {
              id: asset.id,
              version: asset.version,
              deleted: asset.deleted_at !== null,
              erased: asset.file_purged_at !== null,
              owner: { workOrderId: order.id },
            };
      },
      setDeleted: setAssetDeleted,
      lockFiles: lockFilesOfAsset,
      markPurged: (db, id, userId, now) => markAssetPurged(db, id, userId, now),
    };
    this.#documents = {
      objectType: 'document',
      paths: {
        delete: pathOf(zDeleteDocumentPath, 'documentId'),
        restore: pathOf(zRestoreDocumentPath, 'documentId'),
        purge: pathOf(zPurgeDocumentFilePath, 'documentId'),
      },
      register: { code: 'document_file_purged', subjectType: 'document' },
      events: { delete: 'document.deleted', restore: 'document.restored', purge: 'document.file_purged' },
      async find(tx, principal, workOrderId, id) {
        const order = await orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) return undefined;
        const document = await lockDocumentInScope(mediaTables(tx), await scopes.ofOrder(tx, principal, order), id, true);
        if (document === undefined) return undefined;
        const anchor =
          document.work_order_id !== null
            ? { workOrderId: document.work_order_id }
            : document.site_id !== null
              ? { workOrderId: null, anchor: { type: 'site' as const, id: document.site_id } }
              : { workOrderId: null, anchor: { type: 'customer' as const, id: document.customer_id as string } };
        return {
          id: document.id,
          version: document.version,
          deleted: document.deleted_at !== null,
          erased: document.file_purged_at !== null,
          owner: anchor,
        };
      },
      setDeleted: setDocumentDeleted,
      lockFiles: lockFilesOfDocument,
      markPurged: (db, id, userId, now) => markDocumentPurged(db, id, erasureMarker(now), userId, now),
    };
  }

  deleteMedia(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    return this.#setDeleted(this.#media, true, principal, rawParams, context);
  }

  restoreMedia(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    return this.#setDeleted(this.#media, false, principal, rawParams, context);
  }

  purgeMediaFile(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<void> {
    return this.#purge(this.#media, principal, rawParams, rawIfMatch, context);
  }

  deleteDocument(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    return this.#setDeleted(this.#documents, true, principal, rawParams, context);
  }

  restoreDocument(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    return this.#setDeleted(this.#documents, false, principal, rawParams, context);
  }

  purgeDocumentFile(principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<void> {
    return this.#purge(this.#documents, principal, rawParams, rawIfMatch, context);
  }

  async #setDeleted(kind: Kind, deleted: boolean, principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    const operation: Operation = deleted ? 'delete' : 'restore';
    const { workOrderId, id } = kind.paths[operation].parse(rawParams);
    const request = { ...context, sessionId: principal.sessionId };
    await runInTransaction(this.#db, async (tx) => {
      const subject = await kind.find(tx, principal, workOrderId, id);
      if (subject === undefined) throw new ProblemException('not_found');
      if (deleted) {
        // a deleted subject is absent for everybody, the Administrator included (the restore is the only way back)
        if (subject.deleted) throw new ProblemException('not_found');
      } else {
        if (subject.erased) throw new ProblemException('file_erased');
        if (!subject.deleted) throw new ProblemException('invalid_state_transition');
      }
      if (!(await kind.setDeleted(mediaTables(tx), id, principal.userId, deleted, this.#clock.now()))) {
        throw new ProblemException(deleted ? 'not_found' : 'invalid_state_transition');
      }
      await this.#events.publish(tx, this.#event(kind, operation, principal, id, 'success'), request);
    });
  }

  async #purge(kind: Kind, principal: Principal, rawParams: unknown, rawIfMatch: string | undefined, context: EventContext): Promise<void> {
    const { workOrderId, id } = kind.paths.purge.parse(rawParams);
    const storage = requireStorage(this.#storage);
    const request = { ...context, sessionId: principal.sessionId };
    let removal: Removal;
    try {
      removal = await runInTransaction(this.#db, (tx) => this.#erase(tx, kind, principal, workOrderId, id, rawIfMatch, request));
    } catch (error) {
      if (!(error instanceof DeletionRegisterUnavailable)) throw error;
      await this.#recordFailure(kind, principal, id, request);
      throw new ProblemException('deletion_register_unavailable');
    }
    await this.#removeObjects(storage, removal);
  }

  async #erase(
    tx: Kysely<Database>,
    kind: Kind,
    principal: Principal,
    workOrderId: string,
    id: string,
    rawIfMatch: string | undefined,
    request: EventContext,
  ): Promise<Removal> {
    const tables = mediaTables(tx);
    const subject = await kind.find(tx, principal, workOrderId, id);
    if (subject === undefined) throw new ProblemException('not_found');
    const files = await kind.lockFiles(tables, id);
    const fileIds = files.map((file) => file.id);
    const removal = async (): Promise<Removal> => ({
      fileIds,
      keys: [...files.map((file) => file.objectKey), ...(await derivativeKeysOf(tables, fileIds))],
      uploads: await uploadIdsOf(tables, fileIds),
    });
    // a repeat: nothing changes, the removal of the objects is finished again (idempotent)
    if (subject.erased) return removal();

    const expectedVersion = parseIfMatch(rawIfMatch);
    if (subject.version !== expectedVersion) throw new ProblemException('version_conflict');
    if (files.some((file) => isBeingProcessed(file.state))) {
      throw new ProblemException('file_processing', { retryAfterSeconds: FILE_PROCESSING_RETRY_SECONDS });
    }

    // before the change in the database; throws DeletionRegisterUnavailable, which rolls the transaction back
    await this.#register.record({
      operationCode: kind.register.code,
      subjectType: kind.register.subjectType,
      subjectId: id,
      ...subject.owner,
      actorUserId: principal.userId,
    });

    const now = this.#clock.now();
    const planned = await removal();
    await closeSessionsOf(tables, fileIds, now);
    await markFilesErased(tables, fileIds, now);
    await kind.markPurged(tables, id, principal.userId, now);
    await this.#events.publish(tx, this.#event(kind, 'purge', principal, id, 'success'), request);
    return planned;
  }

  /** Aborts the uploads and removes every object; the outcome is recorded when all of it is gone. A failure is `503`, the job of the worker finishes it. */
  async #removeObjects(storage: ObjectStorage, removal: Removal): Promise<void> {
    await viaStorage(async () => {
      for (const upload of removal.uploads) await storage.abortMultipartUpload(upload.objectKey, upload.uploadId);
      for (const key of removal.keys) await storage.deleteObject(key);
    });
    await runInTransaction(this.#db, (tx) => markObjectsErased(mediaTables(tx), removal.fileIds, this.#clock.now()));
  }

  #event(kind: Kind, operation: Operation, principal: Principal, id: string, outcome: MediaAuditEvent['outcome']): MediaAuditEvent {
    return {
      type: kind.events[operation],
      actor: { type: 'user', userId: principal.userId },
      outcome,
      objectType: kind.objectType,
      objectId: id,
      ...(operation === 'purge' ? { reasonCode: 'step_up_verified' as const } : {}),
    };
  }

  /** The audit record of an erasure that did not start (outcome `failed`): a transaction of its own, after the rollback; a failure here is logged. */
  async #recordFailure(kind: Kind, principal: Principal, id: string, request: EventContext): Promise<void> {
    try {
      await runInTransaction(this.#db, (tx) => this.#events.publish(tx, this.#event(kind, 'purge', principal, id, 'failed'), request));
    } catch (error) {
      this.#logger.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'audit of a refused erasure was not written');
    }
  }
}
