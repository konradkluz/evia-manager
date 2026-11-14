/**
 * "Wyślij N plików", step 2 — the upload session of one medium (EVM-044 AC1, AC4, AC5, AC6, AC7; SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05,
 * SR-API-05, SR-API-06). The guard has decided before this runs (Administrator or Editor, web, CSRF).
 *
 * ONE transaction. The order: the path (`400`); the order through the read policy (`404`); the chain order → medium → file in ONE
 * statement with the row of the file locked (`404`: a medium of another order is not found); the storage is configured (`503`); the
 * header and the body (`400`); the idempotency port (a repeat returns the stored result first; the key is bound to the medium); the state
 * of the file: `pending_upload` takes a session, `failed` with `checksum_mismatch` ("Ponów") goes back to `pending_upload` with the
 * SAME key (the new object is a new version of the versioned bucket) - so does `failed` with `abandoned` (EVM-049: a phone that was offline
 * for longer than the sweeper waits loses no medium and needs no new identifier), every other state is `409 invalid_state_transition`; an active
 * session of the caller that has not expired is RETURNED (the resumption after a new choice of the file, AC4; `200`), an expired one is
 * closed, the session of another user is `409 id_conflict` without a detail; the limit of active sessions of the user (`429`,
 * `Retry-After`); `CreateMultipartUpload` with a content type FROM THE ALLOW-LIST, never the client's; the INSERT. The part size is the
 * server's: the URL of every part signs its exact length. Only the creator of the medium or an Administrator opens its session (`404` for
 * everybody else, RR-NOC-T1-8). A REPEAT (same key) whose session is aborted or expired is `409 invalid_state_transition`: the client sends a new
 * key and a new session id.
 */
import type { DocumentUploadSession, UploadSession } from '@evia/contracts';
import { zCreateDocumentUploadSessionBody, zCreateUploadSessionBody } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import type { AppConfig } from '../../../platform/config/config.ts';
import { DEFAULT_MEDIA_LIMITS, type MediaLimits } from '../../../platform/config/media-config.ts';
import { APP_CONFIG, CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { checkSessionDeclaration, sameDeclaration, type FileDeclaration } from '../domain/upload-declaration.ts';
import type { CheckedDeclaration } from '../domain/file-rules.ts';
import { MAX_ACTIVE_SESSIONS_PER_USER, objectKeyFor, planUpload, SESSION_LIFETIME_MS } from '../domain/upload-plan.ts';
import {
  countActiveSessions,
  creatorOfOwner,
  fileOfOwner,
  findActiveSession,
  findAssetWithFile,
  findAssetWithoutFile,
  findOwnerWithFile,
  findSessionChain,
  insertSession,
  insertStoredFile,
  newFileIds,
  setSessionState,
  transitionFile,
  type StoredFileRow,
} from '../infrastructure/media-store.ts';
import { mediaTables, type MediaDb } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { checkPendingLimits } from './pending-limits.ts';
import { creatorOf, idempotencyKeyOf, requireStorage, toDocumentUploadSession, toUploadSession, viaStorage } from './media-support.ts';
import { parseOwnerPath, type OwnerKind } from './owner-path.ts';

export const CREATE_SESSION_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}/upload-sessions';
export const CREATE_DOCUMENT_SESSION_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/documents/{documentId}/upload-sessions';
const scopeOf = (kind: OwnerKind, workOrderId: string, ownerId: string): string =>
  kind === 'document'
    ? CREATE_DOCUMENT_SESSION_SCOPE.replace('{workOrderId}', workOrderId).replace('{documentId}', ownerId)
    : CREATE_SESSION_SCOPE.replace('{workOrderId}', workOrderId).replace('{mediaAssetId}', ownerId);

const mediaBodySchema = strictObjects(zCreateUploadSessionBody);
/** A document takes no declaration of a file: `file` is an unknown field there (EVM-131). */
const documentBodySchema = strictObjects(zCreateDocumentUploadSessionBody);
const RETRY_AFTER_SECONDS = 60;
const sessionIsGone = (session: { state: string; expires_at: Date }, now: Date): boolean =>
  session.state === 'aborted' || session.state === 'expired' || (session.state === 'active' && session.expires_at <= now);

export interface CreatedSession {
  readonly session: UploadSession | DocumentUploadSession;
  /** `201` for a new session, `200` for the resumption of an active one. */
  readonly status: 200 | 201;
  readonly replayed: boolean;
}

@Injectable()
export class CreateUploadSessionService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #storage: ObjectStorage | null;
  readonly #scopes: DocumentScopes;
  readonly #limits: MediaLimits;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(DocumentScopes) scopes: DocumentScopes,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#limits = config.media?.limits ?? DEFAULT_MEDIA_LIMITS;
    this.#scopes = scopes;
    this.#db = db;
    this.#clock = clock;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#storage = storage;
  }

  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    kind: OwnerKind = 'media_asset',
  ): Promise<CreatedSession> {
    const { workOrderId, owner } = parseOwnerPath(kind, 'create', rawParams);
    const creator = creatorOf(principal);

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const tables = mediaTables(tx);
      const documentScope = owner.kind === 'document' ? await this.#scopes.ofOrder(tx, principal, order) : undefined;
      const found = await findOwnerWithFile(tables, order.id, owner, true, documentScope);
      // a medium that has NO file yet (created on the phone, EVM-131): only its creator - never an Administrator who is not, never another user - declares the file; anything else
      // is the same absence as a medium of another order (no takeover of somebody else's medium)
      const pending =
        found === undefined && owner.kind === 'media_asset' ? await findAssetWithoutFile(tables, order.id, owner.id) : undefined;
      if (found === undefined) {
        if (pending === undefined || pending.origin !== 'mobile' || pending.created_by !== principal.userId)
          throw new ProblemException('not_found');
      } else if (creatorOfOwner(found) !== principal.userId && principal.role !== 'administrator') {
        // the creator of the medium or document, or an Administrator (RR-NOC-T1-8): a colleague cannot open a session on what he did not add
        throw new ProblemException('not_found');
      }
      // the file of this owner was erased on purpose (EVM-051): no new session, whatever the state it was left in
      if (found !== undefined && fileOfOwner(found).erased_at !== null) throw new ProblemException('file_erased');
      const storage = requireStorage(this.#storage);
      const key = idempotencyKeyOf(rawKey);
      const { id: sessionId, file: declared } = parseInput(kind === 'document' ? documentBodySchema : mediaBodySchema, rawBody) as {
        id: string;
        file?: FileDeclaration;
      };
      const mediaType = found?.kind === 'media_asset' ? found.found.asset.media_type : pending?.media_type;
      const declaration = this.#declaration(declared, found === undefined ? undefined : fileOfOwner(found), mediaType);
      const now = this.#clock.now();

      let status: 200 | 201 = 201;
      const perform = async () => {
        const file =
          found !== undefined
            ? fileOfOwner(found)
            : await this.#declareFile(tables, order.id, owner.id, principal.userId, declaration, now);
        if (file.state === 'failed' && (file.state_reason_code === 'checksum_mismatch' || file.state_reason_code === 'abandoned')) {
          await transitionFile(
            tables,
            file.id,
            'failed',
            { state: 'pending_upload', sizeBytes: null, contentType: null, sha256: null },
            now,
          );
        } else if (file.state !== 'pending_upload') {
          throw new ProblemException('invalid_state_transition');
        }

        const active = await findActiveSession(tables, file.id);
        if (active !== undefined && active.expires_at > now) {
          if (active.user_id !== creator.userId || active.device_id !== creator.deviceId) throw new ProblemException('id_conflict');
          status = 200;
          return { value: active.id, result: { status: 200, code: 'resumed', resourceId: active.id } };
        }
        if (active !== undefined) {
          await viaStorage(() => storage.abortMultipartUpload(file.object_key, active.s3_upload_id));
          await setSessionState(tables, active.id, 'active', 'expired', now);
        }

        if ((await countActiveSessions(tables, creator.userId, now)) >= MAX_ACTIVE_SESSIONS_PER_USER) {
          throw new ProblemException('rate_limited', { retryAfterSeconds: RETRY_AFTER_SECONDS });
        }
        const plan = planUpload(Number(file.declared_size_bytes));
        const { uploadId } = await viaStorage(() => storage.createMultipartUpload(file.object_key, file.declared_content_type));
        const inserted = await insertSession(
          tables,
          {
            id: sessionId,
            storedFileId: file.id,
            creator,
            s3UploadId: uploadId,
            ...plan,
            expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
          },
          now,
        );
        if (!inserted) {
          await viaStorage(() => storage.abortMultipartUpload(file.object_key, uploadId));
          throw new ProblemException('id_conflict');
        }
        return { value: sessionId, result: { status: 201, code: 'created', resourceId: sessionId } };
      };

      const outcome = await this.#idempotency.run(
        tx,
        {
          userId: principal.userId,
          deviceId: creator.deviceId,
          key,
          scope: scopeOf(kind, order.id, owner.id),
          // the declaration is part of the request: another one under the same key is `422 idempotency_mismatch`; without `file` the hash is the one of the panel
          bodyHash: requestHash(declared === undefined ? { id: sessionId } : { id: sessionId, file: declared }),
        },
        perform,
      );
      const resourceId = outcome.replayed ? outcome.result.resourceId : outcome.value;
      if (outcome.replayed) status = outcome.result.status === 200 ? 200 : 201;
      // read again with the order, the medium and the creator in the condition — a repeat never names the session of another
      const chain =
        resourceId === null
          ? undefined
          : await findSessionChain(
              tables,
              { workOrderId: order.id, owner, sessionId: resourceId, ...(documentScope === undefined ? {} : { documentScope }) },
              creator,
            );
      if (chain === undefined) throw new ProblemException('not_found');
      // a repeat of a creation whose session is gone must not answer 201 with a session nobody can use: the client opens a new one
      if (outcome.replayed && sessionIsGone(chain.session, now)) throw new ProblemException('invalid_state_transition');
      const session = kind === 'document' ? toDocumentUploadSession(chain.session, owner.id) : toUploadSession(chain.session, owner.id);
      return { session, status, replayed: outcome.replayed };
    });
  }

  /**
   * The declaration of the file in the request, judged by the state of the medium (EVM-131; SR-FILE-01, CWE-434): a medium WITHOUT a file needs it (`400` `/file` `required`) and
   * takes the checks of the batch of the panel; a medium WITH a file takes it only when it is the very declaration it has (a repeat after a lost answer) - another one never replaces
   * it (`400` `/file` `not_allowed`). A document takes none (the schema refused it before).
   */
  #declaration(
    declared: FileDeclaration | undefined,
    existing: StoredFileRow | undefined,
    mediaType: 'photo' | 'video' | undefined,
  ): { readonly file: FileDeclaration; readonly checked: CheckedDeclaration } | undefined {
    if (declared === undefined) {
      if (existing === undefined) throw new ProblemException('validation_failed', { errors: [{ pointer: '/file', code: 'required' }] });
      return undefined;
    }
    const checked = checkSessionDeclaration(declared, mediaType ?? 'photo');
    if (!checked.ok) throw new ProblemException('validation_failed', { errors: [...checked.issues] });
    if (existing !== undefined) {
      const stored = {
        declaredSize: Number(existing.declared_size_bytes),
        declaredContentType: existing.declared_content_type,
        declaredSha256: existing.declared_sha256,
        originalFilename: existing.original_filename,
      };
      if (!sameDeclaration(declared, checked.value, stored)) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/file', code: 'not_allowed' }] });
      }
      return undefined;
    }
    return { file: declared, checked: checked.value };
  }

  /**
   * Writes the file of a medium of the phone in `pending_upload` (the medium is locked: two parallel declarations are serialised - the loser finds the winner's file and compares it; the unique
   * `media_asset_id` with `ON CONFLICT DO NOTHING` is the second line - a conflict is `409 id_conflict`, never a `500`). The key of the object is the server's; the name is the cleaned one. The limits of unfinished media are the
   * panel's. @throws ProblemException `limit_exceeded`, `not_found`
   */
  async #declareFile(
    tables: MediaDb,
    workOrderId: string,
    mediaAssetId: string,
    userId: string,
    declaration: { readonly file: FileDeclaration; readonly checked: CheckedDeclaration } | undefined,
    now: Date,
  ): Promise<StoredFileRow> {
    if (declaration === undefined) throw new ProblemException('not_found');
    await checkPendingLimits(tables, this.#limits, userId, workOrderId, 1);
    const [fileId] = await newFileIds(tables, 1);
    const inserted = await insertStoredFile(
      tables,
      {
        id: fileId as string,
        mediaAssetId,
        objectKey: objectKeyFor(fileId as string, now),
        declaredSize: declaration.file.declaredSize,
        declaredContentType: declaration.checked.contentType,
        declaredSha256: declaration.file.sha256,
        originalFilename: declaration.checked.originalFilename,
        createdBy: userId,
      },
      now,
    );
    if (!inserted) throw new ProblemException('id_conflict');
    const stored = await findAssetWithFile(tables, workOrderId, mediaAssetId, true);
    if (stored === undefined) throw new ProblemException('not_found');
    return stored.file;
  }
}
