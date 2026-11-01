/**
 * The signed address of the file of a document (EVM-047 AC5, AC7; SR-FILE-07, SR-FILE-10, SR-WEB-04, SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-06, SR-AUTHZ-07,
 * SR-LOG-02, SR-LOG-03, SR-LOG-07; CWE-639, CWE-362, CWE-367; P6, AB-20).
 *
 * The order of the answer: the guard (401/403) -> the path by schema (400) -> the order through the read policy (404) -> ONE statement for the document of THIS
 * order (404: another order's document, a medium with that id and a missing one) -> the class of the document EFFECTIVE NOW, computed by the server from the
 * database (the kind of the catalog and the override; never from the client) -> the right of the role to that class (`403 forbidden` for Read-only on
 * `building_security` and `identity_data`, WHATEVER the state of the file, so the answer says nothing about it; the refusal is audited in a transaction of its
 * own, with the code of the class and no file name) -> the state of the file (404 unless `clean` or `ready`) -> the limit of the class "originals and documents"
 * (`SignedUrlMeters.reserve`, the SAME counter as the originals of photos: a second one would double the limit of P10; `429`) -> the signature.
 * The issue is audited INSIDE the transaction of the issue (a failed audit means no address - fail closed).
 *
 * The address lives 300 seconds, comes from the host of the bucket and carries what the SERVER chose: the type it DETECTED (never the declaration), `private,
 * no-store`, an `attachment` with a cleaned name, the version of the object that passed the scan. The address and the name are never logged or audited.
 */
import type { DocumentDownloadUrl } from '@evia/contracts';
import { zCreateDocumentDownloadUrlPath } from '@evia/contracts/zod';
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
import { DERIVATIVE_URL_SECONDS, OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import type { SignedUrlMeters } from '../../../platform/signed-url-limits/signed-url-meters.ts';
import { DATABASE, EVENT_BUS, LOGGER, METRICS, SIGNED_URL_METERS } from '../../../platform/tokens.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory } from '../../catalog/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { mayDownloadDocument, type ConfidentialityClass } from '../domain/confidentiality.ts';
import { documentDownloadName, isDocumentOriginalReleasable, normalizeDocumentType } from '../domain/document-rules.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findDocumentWithFile, type DocumentWithFile } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { classOfDocument } from './document-support.ts';
import { requireStorage, viaStorage } from './media-support.ts';
import { ORIGINAL_CACHE_CONTROL, SIGNED_URL_ALERT_METRIC, SIGNED_URL_REJECTED_METRIC } from './media-download-url.service.ts';

const pathSchema = strictObjects(zCreateDocumentDownloadUrlPath);

type Refusal =
  | { readonly kind: 'forbidden'; readonly documentId: string; readonly classCode: ConfidentialityClass }
  | {
      readonly kind: 'rate_limited';
      readonly documentId: string;
      readonly classCode: ConfidentialityClass;
      readonly retryAfterSeconds: number;
      readonly firstRejection: boolean;
    };

type Outcome = { readonly issued: DocumentDownloadUrl } | { readonly refusal: Refusal };

@Injectable()
export class DocumentDownloadUrlService {
  readonly #db: Kysely<Database>;
  readonly #orders: WorkOrderDirectory;
  readonly #kinds: DocumentKindDirectory;
  readonly #storage: ObjectStorage | null;
  readonly #events: EventBus;
  readonly #meters: SignedUrlMeters;
  readonly #logger: Logger;
  readonly #alerts: Counter;
  readonly #rejections: Counter;
  readonly #scopes: DocumentScopes;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(SIGNED_URL_METERS) meters: SignedUrlMeters,
    @Inject(LOGGER) logger: Logger,
    @Inject(METRICS) metrics: MetricsRegistry,
    @Inject(DocumentScopes) scopes: DocumentScopes,
  ) {
    this.#scopes = scopes;
    this.#db = db;
    this.#orders = orders;
    this.#kinds = kinds;
    this.#storage = storage;
    this.#events = events;
    this.#meters = meters;
    this.#logger = logger;
    this.#alerts = metrics.counter(SIGNED_URL_ALERT_METRIC, ['class']);
    this.#rejections = metrics.counter(SIGNED_URL_REJECTED_METRIC, ['class']);
  }

  /** The path of an ORDER: the documents of the order, of its site and of its customer (the site and the customer while visible; EVM-050 W2). */
  create(principal: Principal, rawParams: unknown, context: EventContext): Promise<DocumentDownloadUrl> {
    const { workOrderId, documentId } = parseInput(pathSchema, rawParams) as { workOrderId: string; documentId: string };
    return this.issue(principal, documentId, context, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) return undefined;
      return findDocumentWithFile(mediaTables(tx), await this.#scopes.ofOrder(tx, principal, order), documentId);
    });
  }

  /**
   * The part every path shares (the order, the site, the customer): `find` resolves the anchor of the PATH and reads the document in ONE statement
   * (`undefined` = `404`, the same for a missing anchor, a missing document and a document of another anchor); then the class, the state of the
   * file, the ONE counter, the signature and the audit - in that order, so no answer tells more than the one before it allowed.
   */
  async issue(
    principal: Principal,
    documentId: string,
    context: EventContext,
    find: (tx: Kysely<Database>) => Promise<DocumentWithFile | undefined>,
  ): Promise<DocumentDownloadUrl> {
    const request = { ...context, sessionId: principal.sessionId };
    const result = await runInTransaction(this.#db, async (tx): Promise<Outcome> => {
      const found = await find(tx);
      if (found === undefined) throw new ProblemException('not_found');
      const kinds = await this.#kinds.findByCodes(tx, [found.document.kind_code]);
      const classCode = classOfDocument(found, kinds.get(found.document.kind_code));
      if (!mayDownloadDocument(principal.role, classCode)) return { refusal: { kind: 'forbidden', documentId, classCode } };
      const { file } = found;
      // the files of the document were erased on purpose (EVM-051): there is nothing to sign
      if (file.erased_at !== null) throw new ProblemException('not_found');
      // the type the SERVER detected from the bytes (never the declaration of the client); a file without one, or not past the scan, is not served
      const contentType = file.content_type === null ? undefined : normalizeDocumentType(file.content_type);
      if (!isDocumentOriginalReleasable(file.state) || contentType === undefined) throw new ProblemException('not_found');

      // check and count in ONE synchronous step (no await between them): concurrent requests cannot all pass the check
      const decision = this.#meters.reserve(principal.userId, 'original');
      if (!decision.allowed) {
        const { retryAfterSeconds, firstRejection } = decision;
        this.#rejections.increment({ class: 'original' });
        return { refusal: { kind: 'rate_limited', documentId, classCode, retryAfterSeconds, firstRejection } };
      }
      if (decision.alert) this.#raiseAlert();
      const storage = requireStorage(this.#storage);
      const signed = await viaStorage(() =>
        storage.presignGet({
          key: file.object_key,
          versionId: file.s3_version_id ?? undefined,
          expiresInSeconds: DERIVATIVE_URL_SECONDS,
          contentType,
          cacheControl: ORIGINAL_CACHE_CONTROL,
          disposition: { kind: 'attachment', filename: documentDownloadName(file.original_filename, documentId, contentType) },
        }),
      );
      await this.#audit(tx, 'document_file.downloaded', 'success', principal, documentId, classCode, request);
      if (decision.alert) await this.#audit(tx, 'media_file.download_alerted', 'success', principal, documentId, undefined, request);
      return { issued: { url: signed.url, expiresAt: signed.expiresAt.toISOString() } };
    });
    if ('issued' in result) return result.issued;
    return this.#refuse(principal, result.refusal, request);
  }

  /** Once per window and user (the meter says so); the entry carries no user, document, name or address - the person is named in the audit trail only. */
  #raiseAlert(): void {
    const code: RequestSecurityAlertCode = 'mass_download';
    this.#alerts.increment({ class: 'original' });
    this.#logger.error({ alert: 'security', alertCode: code }, 'security alert');
  }

  async #refuse(principal: Principal, refusal: Refusal, context: EventContext): Promise<never> {
    if (refusal.kind === 'forbidden') {
      await this.#auditOwn('document_file.download_denied', principal, refusal.documentId, refusal.classCode, context);
      throw new ProblemException('forbidden');
    }
    if (refusal.firstRejection) await this.#auditOwn('media_file.download_rejected', principal, refusal.documentId, undefined, context);
    throw new ProblemException('rate_limited', { retryAfterSeconds: refusal.retryAfterSeconds });
  }

  /** A refusal is written in a transaction of its own: the request ends in an error, so its own transaction is rolled back. */
  #auditOwn(
    type: MediaAuditEvent['type'],
    principal: Principal,
    documentId: string,
    classCode: ConfidentialityClass | undefined,
    context: EventContext,
  ): Promise<void> {
    return runInTransaction(this.#db, (tx) => this.#audit(tx, type, 'denied', principal, documentId, classCode, context));
  }

  #audit(
    tx: Kysely<Database>,
    type: MediaAuditEvent['type'],
    outcome: MediaAuditEvent['outcome'],
    principal: Principal,
    documentId: string,
    classCode: ConfidentialityClass | undefined,
    context: EventContext,
  ): Promise<void> {
    const event: MediaAuditEvent = {
      type,
      actor: { type: 'user', userId: principal.userId },
      outcome,
      objectType: 'document',
      objectId: documentId,
      ...(classCode === undefined ? {} : { fromCode: classCode, toCode: classCode }),
    };
    return this.#events.publish(tx, event, context);
  }
}
