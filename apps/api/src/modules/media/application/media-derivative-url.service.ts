/**
 * The signed address of a derivative of a photo (EVM-068 AC6, AC7; SR-FILE-07, SR-WEB-04, SR-AUTHZ-02, SR-AUTHZ-05, SR-LOG-02, CWE-639).
 * The order of the answer (as in the other operations of the module): the guard (401/403) -> the path by schema (400) -> the order through the read
 * policy (404) -> the body by schema (400) -> ONE statement
 * for the medium of THIS order with its file `ready` and the row of the variant (404). The absences are ONE answer: another order, a missing or
 * deleted medium or order, a file in any other state (`clean` is enough for the ORIGINAL, never for a derivative) and a missing row - the caller
 * learns nothing about which. The address lives 300 seconds (a constant of the server), comes from the host of the bucket and forces
 * `image/webp` and `inline`; it is never logged and travels in a response with `Cache-Control: no-store`. No audit of a read (the audit
 * concerns originals and documents, EVM-045); the limits of issuing addresses (SR-FILE-10, P10) come with EVM-045.
 */
import type { MediaDerivativeUrl } from '@evia/contracts';
import { zCreateMediaAssetDownloadUrlBody, zCreateMediaAssetDownloadUrlPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DERIVATIVE_URL_SECONDS, OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { DERIVATIVE_CACHE_CONTROL, DERIVATIVE_CONTENT_TYPE, type DerivativeVariant } from '../domain/derivatives.ts';
import { findReadyDerivative } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { requireStorage, viaStorage } from './media-support.ts';

const pathSchema = strictObjects(zCreateMediaAssetDownloadUrlPath);
const bodySchema = strictObjects(zCreateMediaAssetDownloadUrlBody);

@Injectable()
export class MediaDerivativeUrlService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#orders = orders;
    this.#storage = storage;
  }

  async create(principal: Principal, rawParams: unknown, rawBody: unknown): Promise<MediaDerivativeUrl> {
    const { workOrderId, mediaAssetId } = parseInput(pathSchema, rawParams) as { workOrderId: string; mediaAssetId: string };
    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const { variant } = parseInput(bodySchema, rawBody) as { variant: DerivativeVariant };
      const source = await findReadyDerivative(mediaTables(tx), order.id, mediaAssetId, variant);
      if (source === undefined) throw new ProblemException('not_found');
      const storage = requireStorage(this.#storage);
      const signed = await viaStorage(() =>
        storage.presignGet({
          key: source.objectKey,
          expiresInSeconds: DERIVATIVE_URL_SECONDS,
          contentType: DERIVATIVE_CONTENT_TYPE,
          cacheControl: DERIVATIVE_CACHE_CONTROL,
        }),
      );
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    });
  }
}
