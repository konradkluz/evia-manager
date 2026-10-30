/**
 * The signed address of a file of a photo: the thumbnail, the preview (1600 px) and the ORIGINAL (EVM-068 AC6, AC7; EVM-045 AC2-AC7; SR-FILE-07,
 * SR-FILE-10, SR-WEB-04, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-06, SR-LOG-02, SR-LOG-03, SR-LOG-07; CWE-639, CWE-362, CWE-367).
 *
 * The order of the answer (as in the other operations of the module): the guard (401/403) -> the path by schema (400) -> the order through the read
 * policy (404) -> the body by schema (400) -> the right to the VARIANT (`403 forbidden` for Read-only + original, BEFORE any lookup of the medium, so
 * the answer says nothing about the medium; the refusal is audited in a transaction of its own) -> ONE statement for the medium of THIS order (404:
 * another order, a missing medium, a state that does not allow the file, a missing row, a video or a document) -> the limit of the class
 * (`SignedUrlMeters.reserve`: check and count in one synchronous step, `429`; the first refusal of a window is audited in a transaction of its
 * own) -> the signature. The address of an ORIGINAL is audited INSIDE the transaction of the issue: a failed audit means no address (fail closed).
 *
 * The address lives 300 seconds (a constant of the server), comes from the host of the bucket and carries what the SERVER chose: a derivative is
 * `image/webp` and `inline`; an original has the type the server DETECTED, `private, no-store` and an `attachment` with a cleaned name, and is
 * pinned to the version that passed the scan. The address and the name are never logged and never audited; the answer is `no-store`.
 */
import type { MediaDerivativeUrl } from '@evia/contracts';
import { zCreateMediaAssetDownloadUrlBody, zCreateMediaAssetDownloadUrlPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { RequestSecurityAlertCode } from '../../../platform/bulk-read/bulk-read-control.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import type { Logger } from '../../../platform/logging/logger.ts';
import type { Counter, MetricsRegistry } from '../../../platform/metrics/metrics.ts';
import {
  DERIVATIVE_URL_SECONDS,
  OBJECT_STORAGE,
  type ObjectStorage,
  type SignedGetInput,
} from '../../../platform/object-storage/object-storage.ts';
import type { SignedUrlMeters } from '../../../platform/signed-url-limits/signed-url-meters.ts';
import { DATABASE, EVENT_BUS, LOGGER, METRICS, SIGNED_URL_METERS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { DERIVATIVE_CACHE_CONTROL, DERIVATIVE_CONTENT_TYPE } from '../domain/derivatives.ts';
import { downloadFileName, isOriginalDownloadable, mayRequest, variantClass, type DownloadVariant } from '../domain/downloads.ts';
import { normalizeContentType } from '../domain/file-rules.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findOriginal, findReadyDerivative } from '../infrastructure/media-store.ts';
import { mediaTables, type MediaDb } from '../infrastructure/tables.ts';
import { requireStorage, viaStorage } from './media-support.ts';

const pathSchema = strictObjects(zCreateMediaAssetDownloadUrlPath);
const bodySchema = strictObjects(zCreateMediaAssetDownloadUrlBody);

export const SIGNED_URL_ALERT_METRIC = 'signed_url_alert';
export const SIGNED_URL_REJECTED_METRIC = 'signed_url_rejected';
/** Nothing is cached for an original (it may carry the location): the browser saves it and keeps no copy. */
export const ORIGINAL_CACHE_CONTROL = 'private, no-store';

type Refusal =
  | { readonly kind: 'forbidden'; readonly mediaAssetId: string }
  | { readonly kind: 'rate_limited'; readonly mediaAssetId: string; readonly retryAfterSeconds: number; readonly firstRejection: boolean };

type Outcome = { readonly issued: MediaDerivativeUrl } | { readonly refusal: Refusal };

@Injectable()
export class MediaDownloadUrlService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;
  readonly #storage: ObjectStorage | null;
  readonly #events: EventBus;
  readonly #meters: SignedUrlMeters;
  readonly #logger: Logger;
  readonly #alerts: Counter;
  readonly #rejections: Counter;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(SIGNED_URL_METERS) meters: SignedUrlMeters,
    @Inject(LOGGER) logger: Logger,
    @Inject(METRICS) metrics: MetricsRegistry,
  ) {
    this.#db = db;
    this.#orders = orders;
    this.#storage = storage;
    this.#events = events;
    this.#meters = meters;
    this.#logger = logger;
    this.#alerts = metrics.counter(SIGNED_URL_ALERT_METRIC, ['class']);
    this.#rejections = metrics.counter(SIGNED_URL_REJECTED_METRIC, ['class']);
  }

  async create(principal: Principal, rawParams: unknown, rawBody: unknown, context: EventContext): Promise<MediaDerivativeUrl> {
    const { workOrderId, mediaAssetId } = parseInput(pathSchema, rawParams) as { workOrderId: string; mediaAssetId: string };
    const result = await runInTransaction(this.#db, async (tx): Promise<Outcome> => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const { variant } = parseInput(bodySchema, rawBody) as { variant: DownloadVariant };
      if (!mayRequest(principal.role, variant)) return { refusal: { kind: 'forbidden', mediaAssetId } };
      const media = mediaTables(tx);
      const request =
        variant === 'original'
          ? await this.#original(media, order.id, mediaAssetId)
          : await this.#derivative(media, order.id, mediaAssetId, variant);
      // check and count in ONE synchronous step (no await between them): concurrent requests cannot all pass the check
      const klass = variantClass(variant);
      const decision = this.#meters.reserve(principal.userId, klass);
      if (!decision.allowed) {
        const { retryAfterSeconds, firstRejection } = decision;
        this.#rejections.increment({ class: klass });
        return { refusal: { kind: 'rate_limited', mediaAssetId, retryAfterSeconds, firstRejection } };
      }
      if (decision.alert) this.#raiseAlert(klass);
      const storage = requireStorage(this.#storage);
      const signed = await viaStorage(() => storage.presignGet(request));
      if (variant === 'original') await this.#audit(tx, 'media_file.original_downloaded', 'success', principal, mediaAssetId, context);
      if (decision.alert) await this.#audit(tx, 'media_file.download_alerted', 'success', principal, mediaAssetId, context);
      return { issued: { url: signed.url, expiresAt: signed.expiresAt.toISOString() } };
    });
    if ('issued' in result) return result.issued;
    return this.#refuse(principal, result.refusal, context);
  }

  async #original(media: MediaDb, orderId: string, mediaAssetId: string): Promise<SignedGetInput> {
    const source = await findOriginal(media, orderId, mediaAssetId);
    if (source === undefined || !isOriginalDownloadable(source.state, source.reason)) throw new ProblemException('not_found');
    // the type the SERVER detected from the bytes (never the declaration of the client); a file without one is not served
    const contentType = source.contentType === null ? undefined : normalizeContentType(source.contentType);
    if (contentType === undefined) throw new ProblemException('not_found');
    return {
      key: source.objectKey,
      versionId: source.versionId ?? undefined,
      expiresInSeconds: DERIVATIVE_URL_SECONDS,
      contentType,
      cacheControl: ORIGINAL_CACHE_CONTROL,
      disposition: { kind: 'attachment', filename: downloadFileName(source.originalFilename, mediaAssetId, contentType) },
    };
  }

  async #derivative(media: MediaDb, orderId: string, mediaAssetId: string, variant: 'thumbnail' | 'preview'): Promise<SignedGetInput> {
    const source = await findReadyDerivative(media, orderId, mediaAssetId, variant);
    if (source === undefined) throw new ProblemException('not_found');
    return {
      key: source.objectKey,
      expiresInSeconds: DERIVATIVE_URL_SECONDS,
      contentType: DERIVATIVE_CONTENT_TYPE,
      cacheControl: DERIVATIVE_CACHE_CONTROL,
      disposition: { kind: 'inline' },
    };
  }

  /** Once per window and user (the meter says so); the entry carries no user, medium, name or address - the person is named in the audit trail only. */
  #raiseAlert(klass: 'derivative' | 'original'): void {
    const code: RequestSecurityAlertCode = 'mass_download';
    this.#alerts.increment({ class: klass });
    this.#logger.error({ alert: 'security', alertCode: code }, 'security alert');
  }

  async #refuse(principal: Principal, refusal: Refusal, context: EventContext): Promise<never> {
    if (refusal.kind === 'forbidden') {
      await this.#auditOwn('media_file.original_download_denied', principal, refusal.mediaAssetId, context);
      throw new ProblemException('forbidden');
    }
    if (refusal.firstRejection) await this.#auditOwn('media_file.download_rejected', principal, refusal.mediaAssetId, context);
    throw new ProblemException('rate_limited', { retryAfterSeconds: refusal.retryAfterSeconds });
  }

  /** A refusal is written in a transaction of its own: the request ends in an error, so its own transaction is rolled back. */
  #auditOwn(type: MediaAuditEvent['type'], principal: Principal, mediaAssetId: string, context: EventContext): Promise<void> {
    return runInTransaction(this.#db, (tx) => this.#audit(tx, type, 'denied', principal, mediaAssetId, context));
  }

  #audit(
    tx: Kysely<Database>,
    type: MediaAuditEvent['type'],
    outcome: MediaAuditEvent['outcome'],
    principal: Principal,
    mediaAssetId: string,
    context: EventContext,
  ): Promise<void> {
    const event: MediaAuditEvent = {
      type,
      actor: { type: 'user', userId: principal.userId },
      outcome,
      objectType: 'media_asset',
      objectId: mediaAssetId,
    };
    return this.#events.publish(tx, event, context);
  }
}
