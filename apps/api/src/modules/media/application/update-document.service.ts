/**
 * The change of a document: the class of confidentiality can only RISE (EVM-047 AC4, AC7), the title, the description and the stage can be edited (EVM-048
 * AC3, AC4, AC6, AC7; SR-AUTHZ-02, SR-AUTHZ-04, SR-AUTHZ-05, SR-AUTHZ-07, SR-INPUT-02, SR-INPUT-05, SR-LOG-03, SR-ERR-01; AB-20, TM-17, TM-18). The guard has
 * decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token.
 *
 * ONE transaction on the locked document row. The order: the path (`400`); the order through the read policy (`404`; a settled or cancelled order still accepts
 * the change, PO-8); `If-Match` (`428` missing, `400` malformed); the document of THIS order (`404`: another order's document, a medium with that id and a
 * missing one are the same absence); the body (`400`: the kind, the order, the file and the other fields of the server are `read_only_field`, an empty body is
 * `validation_failed`; the title and the description are plain text, a title empty after trimming is `required`); the version (`412 version_conflict`); the
 * class: the requested one must be STRICTLY above the effective one - the higher of the kind and the current override - else `400 validation_failed`
 * (a fall is refused also in a request that carries a title); the stage - a live stage of THIS order, read under a lock by the facade of `procedures`
 * (`400` at `/procedureStageId`: a stranger's, a deleted and a missing stage are ONE answer); the update (ONE `version + 1`; the trigger of the database
 * refuses a fall of the class as a second line) and the audit: `document.confidentiality_raised` with the class before and after when the class changes,
 * `document.metadata_updated` when the title, the description or the stage changes. Neither event carries the title, the description, the stage or the
 * file name. A request that changes nothing is `200` without a new version and without an event.
 */
import type { Document } from '@evia/contracts';
import { zUpdateDocumentBody, zUpdateDocumentPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import { parseIfMatch } from '../../../platform/http/if-match.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory } from '../../catalog/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { canRaiseTo, effectiveClass, type ConfidentialityOverride } from '../domain/confidentiality.ts';
import { anchorOf, mayRaiseOnAnchor } from '../domain/document-anchor.ts';
import {
  DOCUMENT_DESCRIPTION_MAX,
  isEmpty,
  normaliseDescription,
  normaliseTitle,
  realChange,
  type FieldIssue,
} from '../domain/metadata-patch.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findDocumentWithFile, lockDocumentInScope, updateDocument, type DocumentChange } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { DocumentScopes } from './document-scope.ts';
import { kindClassOf, presentDocuments } from './document-support.ts';
import { assertStageInOrder } from './stage-support.ts';

const pathSchema = strictObjects(zUpdateDocumentPath);
const bodySchema = strictObjects(zUpdateDocumentBody);
/** Everything the client may name in vain: the fields of the document that are the server's (the kind and the order never change). */
const READ_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'workOrderId',
  'kindCode',
  'kindName',
  'procedureStageName',
  'versionNumber',
  'confidentiality',
  'confidentialityRaised',
  'fileState',
  'stateReasonCode',
  'declaredSize',
  'originalFilename',
  'canDownload',
  'createdAt',
  'version',
  'file',
  'containsIdentityData',
  'objectKey',
]);

interface Body {
  readonly title?: string;
  readonly description?: string | null;
  readonly procedureStageId?: string | null;
  readonly confidentialityOverride?: ConfidentialityOverride;
}

export interface UpdatedDocument {
  readonly document: Document;
}

@Injectable()
export class UpdateDocumentService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #orders: WorkOrderDirectory;
  readonly #kinds: DocumentKindDirectory;
  readonly #stages: ProcedureStageDirectory;
  readonly #scopes: DocumentScopes;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
    @Inject(DocumentScopes) scopes: DocumentScopes,
  ) {
    this.#scopes = scopes;
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#orders = orders;
    this.#kinds = kinds;
    this.#stages = stages;
  }

  async update(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    ifMatch: string | undefined,
    context: EventContext,
  ): Promise<UpdatedDocument> {
    const { workOrderId, documentId } = parseInput(pathSchema, rawParams) as { workOrderId: string; documentId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(ifMatch);
      const tables = mediaTables(tx);
      // the documents of the order, of its site and of its customer (the last two while visible; EVM-050 W2) - never a document of another order
      const scope = await this.#scopes.ofOrder(tx, principal, order);
      if ((await lockDocumentInScope(tables, scope, documentId)) === undefined) throw new ProblemException('not_found');
      const found = await findDocumentWithFile(tables, scope, documentId, true);
      if (found === undefined) throw new ProblemException('not_found');
      // a file erased by the administrator keeps its redacted record: nothing is written back into it (SR-PRIV-03)
      if (found.document.file_purged_at !== null) throw new ProblemException('file_erased');
      const body = parseInput(bodySchema, rawBody, READ_ONLY_FIELDS) as Body;
      if (Object.keys(body).length === 0) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '', code: 'required' }] });
      }
      const { document } = found;
      const title = normaliseTitle(body.title);
      const description = normaliseDescription(body.description, DOCUMENT_DESCRIPTION_MAX);
      const issues: FieldIssue[] = [...(title.ok ? [] : [title.issue]), ...(description.ok ? [] : [description.issue])];
      if (issues.length > 0 || !title.ok || !description.ok) throw new ProblemException('validation_failed', { errors: issues });
      if (document.version !== expectedVersion) throw new ProblemException('version_conflict');

      const kinds = await this.#kinds.findByCodes(tx, [document.kind_code]);
      const kindClass = kindClassOf(kinds.get(document.kind_code));
      const before = effectiveClass(kindClass, document.confidentiality_override);
      const raiseTo = body.confidentialityOverride;
      if (raiseTo !== undefined && !canRaiseTo(kindClass, document.confidentiality_override, raiseTo)) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/confidentialityOverride', code: 'not_higher' }] });
      }
      // a site document is shown in the orders of every customer of the site: the class only goes up, so it must never reach identity data (AB-19)
      const anchor = anchorOf(document);
      if (raiseTo !== undefined && !mayRaiseOnAnchor(anchor, raiseTo)) {
        throw new ProblemException('validation_failed', {
          errors: [{ pointer: '/confidentialityOverride', code: 'identity_data_not_on_site' }],
        });
      }
      if (body.procedureStageId != null && anchor !== 'work_order') {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/procedureStageId', code: 'requires_work_order_anchor' }] });
      }
      const metadata: Pick<DocumentChange, 'title' | 'description' | 'procedureStageId'> = realChange(
        { title: title.value, description: description.value, procedureStageId: body.procedureStageId },
        { title: document.title, description: document.description, procedureStageId: document.procedure_stage_id },
      );
      if (metadata.procedureStageId !== undefined && metadata.procedureStageId !== null) {
        await assertStageInOrder(tx, this.#stages, order.id, metadata.procedureStageId, '/procedureStageId');
      }

      if (raiseTo !== undefined || !isEmpty(metadata)) {
        const version = await updateDocument(
          tables,
          documentId,
          expectedVersion,
          { ...metadata, ...(raiseTo === undefined ? {} : { confidentialityOverride: raiseTo }) },
          principal.userId,
          this.#clock.now(),
        );
        if (version === undefined) throw new ProblemException('version_conflict');
        const actor = { type: 'user', userId: principal.userId } as const;
        if (raiseTo !== undefined) {
          const raised: MediaAuditEvent = {
            type: 'document.confidentiality_raised',
            actor,
            outcome: 'success',
            objectType: 'document',
            objectId: documentId,
            fromCode: before,
            toCode: raiseTo,
          };
          await this.#events.publish(tx, raised, request);
        }
        if (!isEmpty(metadata)) {
          const updated: MediaAuditEvent = {
            type: 'document.metadata_updated',
            actor,
            outcome: 'success',
            objectType: 'document',
            objectId: documentId,
          };
          await this.#events.publish(tx, updated, request);
        }
      }
      const fresh = await findDocumentWithFile(tables, scope, documentId);
      if (fresh === undefined) throw new ProblemException('not_found');
      const [presented] = await presentDocuments(tx, this.#kinds, this.#stages, principal.role, [fresh]);
      return { document: presented as Document };
    });
  }
}
