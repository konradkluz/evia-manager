/**
 * The end of an upload: `complete` and `abort` of a session (EVM-044 AC1, AC5, AC6, AC7; SR-FILE-02, SR-CRYPTO-05, SR-AUTHZ-02,
 * SR-AUTHZ-05, SR-ERR-01). Only the creator of the session reaches either (`404` for everybody else). One transaction on the locked file
 * and session.
 *
 * `complete`: a session already `completed` answers with the current medium (a repeat is harmless); `aborted`, `expired` or past its
 * `expiresAt` is `409 invalid_state_transition`. The server asks the STORAGE for the parts (it never trusts the ETags of a client) and
 * checks them against ITS plan — the number, the length of each, the total (`422 upload_incomplete`: `parts_missing` or `size_mismatch`) —
 * then assembles the object and reads its length with `HEAD` (a different length is `422 size_mismatch`). A storage that no longer
 * knows the upload (a repeat after the assembly) is resolved by the `HEAD` too: an object of the declared length means the first call
 * did succeed. The file goes `pending_upload → uploaded` by compare-and-set with the version and the ETag of the object, the session
 * to `completed`; the scan, the checksum and the type are the worker's (EVM-044 AC2, AC3, AC5).
 *
 * `abort`: an active session is closed and its upload dropped in the storage; an `aborted` or `expired` one answers `204` again;
 * a `completed` one is `409`. The file stays `pending_upload` and may get a new session.
 */
import type { Document, MediaAsset } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import {
  ObjectStorageError,
  OBJECT_STORAGE,
  type CompletedObject,
  type ObjectStorage,
} from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { checkStoredParts } from '../domain/upload-plan.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory } from '../../catalog/index.ts';
import { findDocumentWithFile, type DocumentWithFile } from '../infrastructure/document-store.ts';
import {
  findAssetWithFile,
  setSessionState,
  transitionFile,
  type AssetWithFile,
  type SessionChain,
} from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { requireStorage, toMediaAsset, viaStorage } from './media-support.ts';
import { parseOwnerPath, type OwnerKind, type OwnerPath } from './owner-path.ts';
import { presentDocuments } from './document-support.ts';
import { SessionAccess } from './session-access.ts';

@Injectable()
export class FinishUploadService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #access: SessionAccess;
  readonly #storage: ObjectStorage | null;
  readonly #kinds: DocumentKindDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(SessionAccess) access: SessionAccess,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#access = access;
    this.#storage = storage;
    this.#kinds = kinds;
  }

  /** `complete` of a session of a MEDIUM: the answer is the medium (read again: the chain was read and locked in this very transaction, so the row is there). */
  completeMedia(principal: Principal, rawParams: unknown): Promise<MediaAsset> {
    return this.#complete(principal, rawParams, 'media_asset', async (tx, _chain, ids) =>
      toMediaAsset((await findAssetWithFile(mediaTables(tx), ids.workOrderId, ids.owner.id)) as AssetWithFile),
    );
  }

  /** `complete` of a session of a DOCUMENT: the answer is the document (the kind and the class are the server's, from the catalog). */
  completeDocument(principal: Principal, rawParams: unknown): Promise<Document> {
    return this.#complete(principal, rawParams, 'document', async (tx, _chain, ids) => {
      const found = (await findDocumentWithFile(mediaTables(tx), ids.workOrderId, ids.owner.id)) as DocumentWithFile;
      return (await presentDocuments(tx, this.#kinds, principal.role, [found]))[0] as Document;
    });
  }

  async #complete<T>(
    principal: Principal,
    rawParams: unknown,
    kind: OwnerKind,
    present: (tx: Kysely<Database>, chain: SessionChain, ids: OwnerPath) => Promise<T>,
  ): Promise<T> {
    const ids = parseOwnerPath(kind, 'complete', rawParams);
    return runInTransaction(this.#db, async (tx) => {
      const chain = await this.#access.open(tx, principal, ids, true);
      const storage = requireStorage(this.#storage);
      const now = this.#clock.now();
      const tables = mediaTables(tx);
      if (chain.session.state === 'completed') return present(tx, chain, ids);
      if (chain.session.state !== 'active') throw new ProblemException('invalid_state_transition');
      if (chain.session.expires_at <= now) throw new ProblemException('invalid_state_transition');
      if (chain.file.state !== 'pending_upload') throw new ProblemException('invalid_state_transition');

      const declaredSize = Number(chain.file.declared_size_bytes);
      const assembled = await this.#assemble(storage, chain, declaredSize);
      // the file row is locked by this transaction and was seen in `pending_upload` above: the compare-and-set cannot lose
      await transitionFile(
        tables,
        chain.file.id,
        'pending_upload',
        { state: 'uploaded', sizeBytes: assembled.size, s3VersionId: assembled.versionId ?? null, s3Etag: assembled.etag },
        now,
      );
      await setSessionState(tables, chain.session.id, 'active', 'completed', now);
      return present(tx, chain, ids);
    });
  }

  async abort(principal: Principal, rawParams: unknown, kind: OwnerKind = 'media_asset'): Promise<void> {
    const ids = parseOwnerPath(kind, 'abort', rawParams);
    await runInTransaction(this.#db, async (tx) => {
      const chain = await this.#access.open(tx, principal, ids, true);
      if (chain.session.state === 'completed') throw new ProblemException('invalid_state_transition');
      if (chain.session.state !== 'active') return;
      const storage = requireStorage(this.#storage);
      await viaStorage(() => storage.abortMultipartUpload(chain.file.object_key, chain.session.s3_upload_id));
      await setSessionState(mediaTables(tx), chain.session.id, 'active', 'aborted', this.#clock.now());
    });
  }

  /** The parts the storage holds, checked against the plan, assembled, and the length of the object read back. */
  async #assemble(storage: ObjectStorage, chain: SessionChain, declaredSize: number): Promise<{ size: number } & CompletedObject> {
    const plan = { partSize: Number(chain.session.part_size_bytes), partCount: chain.session.part_count };
    const key = chain.file.object_key;
    const uploadId = chain.session.s3_upload_id;
    let completed: CompletedObject | undefined;
    try {
      const parts = await viaStorage(() => storage.listParts(key, uploadId), ['no_such_upload']);
      const check = checkStoredParts(declaredSize, plan, parts);
      if (!check.ok) throw new ProblemException('upload_incomplete', { errors: [{ pointer: '', code: check.code ?? 'size_mismatch' }] });
      completed = await viaStorage(() => storage.completeMultipartUpload(key, uploadId, parts), ['no_such_upload']);
    } catch (error) {
      // a repeat after the assembly: the storage no longer knows the upload — the object itself tells whether the first call did succeed
      if (!(error instanceof ObjectStorageError) || error.code !== 'no_such_upload') throw error;
    }
    const head = await viaStorage(() => storage.head(key));
    if (head === undefined) throw new ProblemException('invalid_state_transition');
    if (head.size !== declaredSize) throw new ProblemException('upload_incomplete', { errors: [{ pointer: '', code: 'size_mismatch' }] });
    return { size: head.size, etag: completed?.etag ?? head.etag, versionId: completed?.versionId ?? head.versionId };
  }
}
