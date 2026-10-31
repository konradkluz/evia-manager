/**
 * "Podnieś klasę" - the class of confidentiality of a document can only RISE (EVM-047 AC4, AC7; SR-AUTHZ-02, SR-AUTHZ-05, SR-AUTHZ-07, SR-LOG-03, SR-API-06;
 * AB-20). The guard has decided before this runs: a signed-in Administrator or Editor on the web channel with a valid CSRF token.
 *
 * ONE transaction on the locked file row. The order: the path (`400`); the order through the read policy (`404`); `If-Match` (`428` missing, `400`
 * malformed); the document of THIS order (`404`: another order's document, a medium with that id and a missing one are the same absence); the body (`400`:
 * `confidentialityOverride` is the ONLY field - every other one, `title` and `kindCode` included, is `read_only_field`); the version (`412 version_conflict`);
 * the class: the requested one must be STRICTLY above the effective one - the higher of the kind and the current override - else `400 validation_failed`; the
 * update (`version + 1`; the trigger of the database refuses a fall as a second line) and ONE audit event with the class before and after. The title, the
 * description and the file name appear in no audit event. The kind and the order of a document never change.
 */
import type { Document } from '@evia/contracts';
import { zRaiseDocumentConfidentialityBody, zRaiseDocumentConfidentialityPath } from '@evia/contracts/zod';
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { canRaiseTo, effectiveClass, type ConfidentialityOverride } from '../domain/confidentiality.ts';
import type { MediaAuditEvent } from '../events.ts';
import { findDocumentWithFile, raiseOverride } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { kindClassOf, presentDocuments } from './document-support.ts';

const pathSchema = strictObjects(zRaiseDocumentConfidentialityPath);
const bodySchema = strictObjects(zRaiseDocumentConfidentialityBody);
/** Everything the client may name in vain: the fields of the document are the server's (`title` and `kindCode` too: editing them is not part of this story). */
const READ_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'workOrderId',
  'kindCode',
  'kindName',
  'title',
  'description',
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
]);

export interface RaisedDocument {
  readonly document: Document;
}

@Injectable()
export class RaiseDocumentConfidentialityService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #orders: WorkOrderDirectory;
  readonly #kinds: DocumentKindDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#orders = orders;
    this.#kinds = kinds;
  }

  async raise(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    ifMatch: string | undefined,
    context: EventContext,
  ): Promise<RaisedDocument> {
    const { workOrderId, documentId } = parseInput(pathSchema, rawParams) as { workOrderId: string; documentId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      const expectedVersion = parseIfMatch(ifMatch);
      const tables = mediaTables(tx);
      const found = await findDocumentWithFile(tables, order.id, documentId, true);
      if (found === undefined) throw new ProblemException('not_found');
      const { confidentialityOverride } = parseInput(bodySchema, rawBody, READ_ONLY_FIELDS) as {
        confidentialityOverride: ConfidentialityOverride;
      };
      if (found.document.version !== expectedVersion) throw new ProblemException('version_conflict');

      const kinds = await this.#kinds.findByCodes(tx, [found.document.kind_code]);
      const kindClass = kindClassOf(kinds.get(found.document.kind_code));
      const before = effectiveClass(kindClass, found.document.confidentiality_override);
      if (!canRaiseTo(kindClass, found.document.confidentiality_override, confidentialityOverride)) {
        throw new ProblemException('validation_failed', { errors: [{ pointer: '/confidentialityOverride', code: 'not_higher' }] });
      }
      const version = await raiseOverride(
        tables,
        documentId,
        expectedVersion,
        confidentialityOverride,
        principal.userId,
        this.#clock.now(),
      );
      if (version === undefined) throw new ProblemException('version_conflict');
      const audited: MediaAuditEvent = {
        type: 'document.confidentiality_raised',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'document',
        objectId: documentId,
        fromCode: before,
        toCode: confidentialityOverride,
      };
      await this.#events.publish(tx, audited, request);
      const fresh = await findDocumentWithFile(tables, order.id, documentId);
      if (fresh === undefined) throw new ProblemException('not_found');
      const [document] = await presentDocuments(tx, this.#kinds, principal.role, [fresh]);
      return { document: document as Document };
    });
  }
}
