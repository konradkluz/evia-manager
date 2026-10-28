/**
 * "Wyślij N plików", step 2 — the upload session of one medium (EVM-044 AC1, AC4, AC5, AC6, AC7; SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05,
 * SR-API-05, SR-API-06). The guard has decided before this runs (Administrator or Editor, web, CSRF).
 *
 * ONE transaction. The order: the path (`400`); the order through the read policy (`404`); the chain order → medium → file in ONE
 * statement with the row of the file locked (`404`: a medium of another order is not found); the storage is configured (`503`); the
 * header and the body (`400`); the idempotency port (a repeat returns the stored result first; the key is bound to the medium); the state
 * of the file: `pending_upload` takes a session, `failed` with `checksum_mismatch` ("Ponów") goes back to `pending_upload` with the
 * SAME key (the new object is a new version of the versioned bucket), every other state is `409 invalid_state_transition`; an active
 * session of the caller that has not expired is RETURNED (the resumption after a new choice of the file, AC4; `200`), an expired one is
 * closed, the session of another user is `409 id_conflict` without a detail; the limit of active sessions of the user (`429`,
 * `Retry-After`); `CreateMultipartUpload` with a content type FROM THE ALLOW-LIST, never the client's; the INSERT. The part size is the
 * server's: the URL of every part signs its exact length. Only the creator of the medium or an Administrator opens its session (`404` for
 * everybody else, RR-NOC-T1-8). A REPEAT (same key) whose session is aborted or expired is `409 invalid_state_transition`: the client sends a new
 * key and a new session id.
 */
import type { UploadSession } from '@evia/contracts';
import { zCreateUploadSessionBody, zCreateUploadSessionPath } from '@evia/contracts/zod';
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
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { MAX_ACTIVE_SESSIONS_PER_USER, planUpload, SESSION_LIFETIME_MS } from '../domain/upload-plan.ts';
import {
  countActiveSessions,
  findActiveSession,
  findAssetWithFile,
  findSessionChain,
  insertSession,
  setSessionState,
  transitionFile,
} from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { creatorOf, idempotencyKeyOf, requireStorage, toUploadSession, viaStorage } from './media-support.ts';

export const CREATE_SESSION_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/media-assets/{mediaAssetId}/upload-sessions';
const scopeOf = (workOrderId: string, mediaAssetId: string): string =>
  CREATE_SESSION_SCOPE.replace('{workOrderId}', workOrderId).replace('{mediaAssetId}', mediaAssetId);

const pathSchema = strictObjects(zCreateUploadSessionPath);
const bodySchema = strictObjects(zCreateUploadSessionBody);
const RETRY_AFTER_SECONDS = 60;
const sessionIsGone = (session: { state: string; expires_at: Date }, now: Date): boolean =>
  session.state === 'aborted' || session.state === 'expired' || (session.state === 'active' && session.expires_at <= now);

export interface CreatedSession {
  readonly session: UploadSession;
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

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#storage = storage;
  }

  async create(principal: Principal, rawParams: unknown, rawBody: unknown, rawKey: string | undefined): Promise<CreatedSession> {
    const { workOrderId, mediaAssetId } = parseInput(pathSchema, rawParams) as { workOrderId: string; mediaAssetId: string };
    const creator = creatorOf(principal);

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const tables = mediaTables(tx);
      const found = await findAssetWithFile(tables, order.id, mediaAssetId, true);
      // the creator of the medium or an Administrator (RR-NOC-T1-8): a colleague cannot open a session on a medium he did not add
      if (found === undefined || (found.asset.created_by !== principal.userId && principal.role !== 'administrator')) {
        throw new ProblemException('not_found');
      }
      const storage = requireStorage(this.#storage);
      const key = idempotencyKeyOf(rawKey);
      const { id: sessionId } = parseInput(bodySchema, rawBody) as { id: string };
      const now = this.#clock.now();

      let status: 200 | 201 = 201;
      const perform = async () => {
        const { file } = found;
        if (file.state === 'failed' && file.state_reason_code === 'checksum_mismatch') {
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
        { userId: principal.userId, deviceId: null, key, scope: scopeOf(order.id, mediaAssetId), bodyHash: requestHash({ id: sessionId }) },
        perform,
      );
      const resourceId = outcome.replayed ? outcome.result.resourceId : outcome.value;
      if (outcome.replayed) status = outcome.result.status === 200 ? 200 : 201;
      // read again with the order, the medium and the creator in the condition — a repeat never names the session of another
      const chain =
        resourceId === null
          ? undefined
          : await findSessionChain(tables, { workOrderId: order.id, mediaAssetId, sessionId: resourceId }, creator);
      if (chain === undefined) throw new ProblemException('not_found');
      // a repeat of a creation whose session is gone must not answer 201 with a session nobody can use: the client opens a new one
      if (outcome.replayed && sessionIsGone(chain.session, now)) throw new ProblemException('invalid_state_transition');
      return { session: toUploadSession(chain.session, mediaAssetId), status, replayed: outcome.replayed };
    });
  }
}
