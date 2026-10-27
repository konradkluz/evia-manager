/**
 * The parts of a session (EVM-044 AC4, AC6, AC7; SR-FILE-02, SR-AUTHZ-02, SR-AUTHZ-05, SR-LOG-02): the list of the parts the storage holds
 * (`ListParts` on the server — the resumption starts at the first missing one) and the signed URL of ONE part. Only the creator of an
 * ACTIVE, unexpired session reaches either (`404` for everybody else, `409 invalid_state_transition` for a finished or expired one). The
 * URL signs the key, the upload, the part number and the exact length the SERVER computed from its plan, lives 3600 seconds, is never logged
 * and travels in a response with `Cache-Control: no-store`.
 */
import type { UploadPartList, UploadPartUrl } from '@evia/contracts';
import { zGetUploadPartUrlPath, zListUploadPartsPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE } from '../../../platform/tokens.ts';
import { partLength, PART_URL_SECONDS } from '../domain/upload-plan.ts';
import type { SessionChain } from '../infrastructure/media-store.ts';
import { requireStorage, viaStorage } from './media-support.ts';
import { SessionAccess } from './session-access.ts';

const listPath = strictObjects(zListUploadPartsPath);
const urlPath = strictObjects(zGetUploadPartUrlPath);

/** The path parameters arrive as strings: a part number of up to four digits becomes a number, anything else stays and fails the schema. */
function withNumericPart(rawParams: unknown): unknown {
  if (typeof rawParams !== 'object' || rawParams === null) return rawParams;
  const raw = rawParams as Record<string, unknown>;
  const part = raw['partNumber'];
  return typeof part === 'string' && /^[0-9]{1,4}$/.test(part) ? { ...raw, partNumber: Number(part) } : raw;
}

@Injectable()
export class UploadPartsService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #access: SessionAccess;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(SessionAccess) access: SessionAccess,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#access = access;
    this.#storage = storage;
  }

  async list(principal: Principal, rawParams: unknown): Promise<UploadPartList> {
    const ids = parseInput(listPath, rawParams) as { workOrderId: string; mediaAssetId: string; sessionId: string };
    return runInTransaction(this.#db, async (tx) => {
      const chain = await this.#access.open(tx, principal, ids);
      const storage = requireStorage(this.#storage);
      this.#assertActive(chain);
      const parts = await viaStorage(() => storage.listParts(chain.file.object_key, chain.session.s3_upload_id), ['no_such_upload']).catch(
        (error: unknown) => {
          // the upload is gone from the storage (assembled by a repeat, or removed by the lifecycle): the session is no longer usable
          if (error instanceof ProblemException) throw error;
          throw new ProblemException('invalid_state_transition');
        },
      );
      return { items: parts.map((part) => ({ partNumber: part.partNumber, size: part.size })) };
    });
  }

  async url(principal: Principal, rawParams: unknown): Promise<UploadPartUrl> {
    const ids = parseInput(urlPath, withNumericPart(rawParams)) as {
      workOrderId: string;
      mediaAssetId: string;
      sessionId: string;
      partNumber: number;
    };
    return runInTransaction(this.#db, async (tx) => {
      const chain = await this.#access.open(tx, principal, ids);
      const storage = requireStorage(this.#storage);
      this.#assertActive(chain);
      const plan = { partSize: Number(chain.session.part_size_bytes), partCount: chain.session.part_count };
      const length = partLength(Number(chain.file.declared_size_bytes), plan, ids.partNumber);
      if (length === undefined) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/partNumber', code: 'out_of_range' }] });
      }
      const signed = await viaStorage(() =>
        storage.presignUploadPart({
          key: chain.file.object_key,
          uploadId: chain.session.s3_upload_id,
          partNumber: ids.partNumber,
          contentLength: length,
          expiresInSeconds: PART_URL_SECONDS,
        }),
      );
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), contentLength: length };
    });
  }

  /** A finished, aborted or expired session, or a file that left `pending_upload`, takes no more parts. */
  #assertActive(chain: SessionChain): void {
    if (chain.session.state !== 'active' || chain.session.expires_at <= this.#clock.now() || chain.file.state !== 'pending_upload') {
      throw new ProblemException('invalid_state_transition');
    }
  }
}
