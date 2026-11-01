/**
 * "Dodaj dokument" - a document with its version 1 and the file in `pending_upload` (EVM-047 AC1-AC4, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-07,
 * SR-INPUT-01, SR-FILE-01, SR-FILE-03, SR-API-05, SR-API-06, SR-LOG-03). The guard has decided before this runs: a signed-in Administrator or Editor on
 * the web channel with a valid CSRF token - Read-only gets 403 and an anonymous caller 401 without reaching the headers, the body or the table of
 * idempotency records.
 *
 * ONE transaction. The order: the path (`400`); the order of the path through the read policy (`404`); the storage is configured (`503`, fail closed);
 * the `Idempotency-Key` and the strict body (`400`; fields of the server - `read_only_field`); the kind from the catalog (`400 unknown_kind` for a missing or
 * retired one, never a `500` from a key); the class (`other` needs the answer about identity data; an override must be strictly above the kind) and the
 * file (type, extension, size - `400`, pointers `/file/...`, codes, never values); the idempotency port (a repeat returns the stored result BEFORE the writes;
 * the key is bound to the ORDER); then the INSERT of the document (an identifier that exists - in any order, of any user - is `409 id_conflict`, nothing of
 * it is read), of its version 1 and of its file (the key of the object is assigned HERE: `documents/{year}/{month}/{id of the file}/original`), ONE entry of
 * the journal (the id of the document and the code of its kind) and one audit event (the class as a code). An order that is closed still accepts documents
 * ("nic nie ginie", PO-8). An error anywhere rolls the whole command back. The title, the description and the file name appear in no log, audit event,
 * journal entry or error message.
 */
import type { Document } from '@evia/contracts';
import { zCreateDocumentBody, zCreateDocumentPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { requestHash } from '../../../platform/idempotency/canonical-json.ts';
import { IDEMPOTENCY, type Idempotency } from '../../../platform/idempotency/idempotency.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory, type DocumentKindForDocument } from '../../catalog/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { effectiveClass, resolveNewDocumentClass, type ConfidentialityOverride } from '../domain/confidentiality.ts';
import { checkAnchor, type DocumentAnchor } from '../domain/document-anchor.ts';
import { checkDocumentDeclaration } from '../domain/document-rules.ts';
import { documentObjectKeyFor } from '../domain/upload-plan.ts';
import type { DocumentAddedEvent, MediaAuditEvent } from '../events.ts';
import {
  findDocumentWithFile,
  insertDocument,
  insertDocumentFile,
  insertDocumentVersion,
  type DocumentScope,
} from '../infrastructure/document-store.ts';
import { newFileIds } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { presentDocuments } from './document-support.ts';
import { assertStageInOrder } from './stage-support.ts';
import { idempotencyKeyOf, requireStorage } from './media-support.ts';

export const CREATE_DOCUMENT_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/documents';
const scopeOf = (workOrderId: string): string => CREATE_DOCUMENT_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreateDocumentPath);
const bodySchema = strictObjects(zCreateDocumentBody);
/** Fields of the server the client names in vain (`read_only_field` at the root; nested ones are unknown fields). */
const SERVER_FIELDS: ReadonlySet<string> = new Set([
  'workOrderId',
  'siteId',
  'customerId',
  'kindName',
  'versionNumber',
  'fileState',
  'stateReasonCode',
  'confidentiality',
  'confidentialityRaised',
  'canDownload',
  'declaredSize',
  'originalFilename',
  'createdAt',
  'version',
  'objectKey',
]);

/** Controls (C0, C1) and the invisible characters that reorder or hide text. */
const FORBIDDEN_TEXT = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
/** A description may carry line breaks and tabs, nothing else of the above. */
const hasForbidden = (value: string, allowBreaks: boolean): boolean =>
  FORBIDDEN_TEXT.test(allowBreaks ? value.replace(/[\n\r\t]/g, '') : value);

interface Input {
  readonly id: string;
  readonly anchor?: DocumentAnchor | undefined;
  readonly kindCode: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly procedureStageId?: string | undefined;
  readonly containsIdentityData?: boolean | undefined;
  readonly confidentialityOverride?: ConfidentialityOverride | undefined;
  readonly file: { readonly fileName: string; readonly contentType: string; readonly declaredSize: number; readonly sha256: string };
}

interface Checked {
  readonly kind: DocumentKindForDocument;
  readonly override: ConfidentialityOverride | null;
  readonly contentType: string;
  readonly originalFilename: string;
}

interface AnchorColumns {
  readonly workOrderId: string | null;
  readonly siteId: string | null;
  readonly customerId: string | null;
}

/** The ids of the anchor the document is stored with: the server takes them from the order of the PATH, the client names none (SR-AUTHZ-04). */
const anchorColumns = (anchor: DocumentAnchor, scope: DocumentScope): AnchorColumns => ({
  workOrderId: anchor === 'work_order' ? (scope.workOrderId as string) : null,
  siteId: anchor === 'site' ? (scope.siteId as string) : null,
  customerId: anchor === 'customer' ? (scope.customerId as string) : null,
});

/** The scope that holds ONLY the anchor of the document just written. */
const onlyAnchor = (anchor: DocumentAnchor, scope: DocumentScope): DocumentScope => {
  const columns = anchorColumns(anchor, scope);
  return {
    workOrderId: columns.workOrderId ?? undefined,
    siteId: columns.siteId ?? undefined,
    customerId: columns.customerId ?? undefined,
  };
};

export interface CreatedDocument {
  readonly document: Document;
  readonly replayed: boolean;
}

@Injectable()
export class CreateDocumentService {
  readonly #db: Kysely<Database>;
  readonly #stages: ProcedureStageDirectory;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #kinds: DocumentKindDirectory;
  readonly #storage: ObjectStorage | null;
  readonly #scopes: DocumentScopes;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(DocumentScopes) scopes: DocumentScopes,
  ) {
    this.#scopes = scopes;
    this.#stages = stages;
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#kinds = kinds;
    this.#storage = storage;
  }

  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<CreatedDocument> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      requireStorage(this.#storage);
      const key = idempotencyKeyOf(rawKey);
      const input = parseInput(bodySchema, rawBody, SERVER_FIELDS) as Input;
      const anchor = input.anchor ?? 'work_order';
      const scope = await this.#scopes.ofOrder(tx, principal, order);
      const checked = await this.#validate(tx, input, anchor, scope);

      const perform = async () => {
        await this.#add(tx, principal, order.id, anchorColumns(anchor, scope), input, checked, request);
        return { value: undefined, result: { status: 201, code: 'created', resourceId: input.id } };
      };
      const { replayed } = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: scopeOf(order.id), bodyHash: requestHash({ ...input, anchor }) },
        perform,
      );
      // read again with the anchor of the URL in the condition: a repeat never names a document of another anchor (the key binds the anchor too)
      const found = await findDocumentWithFile(mediaTables(tx), onlyAnchor(anchor, scope), input.id);
      if (found === undefined) throw new ProblemException('not_found');
      const [document] = await presentDocuments(tx, this.#kinds, this.#stages, principal.role, [found]);
      return { document: document as Document, replayed };
    });
  }

  /** Everything the client may get wrong, as codes at pointers (never values): the texts, the kind, the class and the file. */
  async #validate(tx: Kysely<Database>, input: Input, anchor: DocumentAnchor, scope: DocumentScope): Promise<Checked> {
    const errors: Array<{ pointer: string; code: string }> = [];
    const title = input.title.trim();
    if (title === '') errors.push({ pointer: '/title', code: 'required' });
    else if (hasForbidden(title, false)) errors.push({ pointer: '/title', code: 'invalid_characters' });
    if (input.description !== undefined && hasForbidden(input.description, true)) {
      errors.push({ pointer: '/description', code: 'invalid_characters' });
    }

    const kind = await this.#kinds.findActiveByCode(tx, input.kindCode);
    if (kind === undefined) errors.push({ pointer: '/kindCode', code: 'unknown_kind' });
    const classification =
      kind === undefined
        ? undefined
        : resolveNewDocumentClass({
            kindCode: kind.code,
            kindClass: kind.confidentiality,
            containsIdentityData: input.containsIdentityData,
            confidentialityOverride: input.confidentialityOverride,
          });
    if (classification !== undefined && !classification.ok) {
      for (const issue of classification.issues) errors.push({ pointer: `/${issue.field}`, code: issue.code });
    }
    if (kind !== undefined && classification !== undefined && classification.ok) {
      const documentClass = effectiveClass(kind.confidentiality, classification.override);
      errors.push(
        ...checkAnchor({
          anchor,
          hasSite: scope.siteId !== undefined,
          hasCustomer: scope.customerId !== undefined,
          hasStage: input.procedureStageId !== undefined,
          documentClass,
        }),
      );
    }
    const declaration = checkDocumentDeclaration(input.file);
    if (!declaration.ok) for (const issue of declaration.issues) errors.push({ pointer: `/file/${issue.field}`, code: issue.code });
    if (errors.length > 0 || kind === undefined || classification === undefined || !classification.ok || !declaration.ok) {
      throw new ProblemException('validation_failed', { errors });
    }
    return {
      kind,
      override: classification.override,
      contentType: declaration.value.contentType,
      originalFilename: declaration.value.originalFilename,
    };
  }

  async #add(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    anchorIds: AnchorColumns,
    input: Input,
    checked: Checked,
    request: EventContext,
  ): Promise<void> {
    const now = this.#clock.now();
    const tables = mediaTables(tx);
    // the stage must be a live stage of THIS order (EVM-048 AC1, AC4; SR-AUTHZ-02): ONE answer for a stranger's, a deleted and a missing one
    if (input.procedureStageId !== undefined) {
      await assertStageInOrder(tx, this.#stages, workOrderId, input.procedureStageId, '/procedureStageId');
    }
    const inserted = await insertDocument(
      tables,
      {
        id: input.id,
        kindCode: checked.kind.code,
        title: input.title.trim(),
        description: input.description ?? null,
        ...anchorIds,
        procedureStageId: input.procedureStageId ?? null,
        confidentialityOverride: checked.override,
        createdBy: principal.userId,
      },
      now,
    );
    if (!inserted) throw new ProblemException('id_conflict');
    const [versionId, fileId] = (await newFileIds(tables, 2)) as [string, string];
    await insertDocumentVersion(tables, { id: versionId, documentId: input.id, versionNumber: 1, createdBy: principal.userId }, now);
    await insertDocumentFile(
      tables,
      {
        id: fileId,
        documentVersionId: versionId,
        objectKey: documentObjectKeyFor(fileId, now),
        declaredSize: input.file.declaredSize,
        declaredContentType: checked.contentType,
        declaredSha256: input.file.sha256,
        originalFilename: checked.originalFilename,
        createdBy: principal.userId,
      },
      now,
    );
    const added: DocumentAddedEvent = {
      type: 'media.document_added',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      workOrderId,
      documentId: input.id,
      kindCode: checked.kind.code,
    };
    await this.#events.publish(tx, added, request);
    const classCode = effectiveClass(checked.kind.confidentiality, checked.override);
    const audited: MediaAuditEvent = {
      type: 'document.created',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      objectType: 'document',
      objectId: input.id,
      fromCode: classCode,
      toCode: classCode,
    };
    await this.#events.publish(tx, audited, request);
  }
}
