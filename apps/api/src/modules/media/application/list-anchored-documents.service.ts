/**
 * The lists "Dokumenty lokalizacji (n)" and "Dokumenty klienta (n)" (EVM-050 AC2, AC4, AC7; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-05, SR-AUTHZ-08, SR-API-02).
 * The site (or the customer) of the path goes through the read policy of its module first (`404` for a missing and a deleted one, every role); ONE
 * statement then reads the documents whose OWN anchor is that site (customer) - never the documents or the media of an order, which is what makes the
 * list of a site safe in the presence of other orders of the same site. The total is counted by the same predicate. The cursor is bound to the anchor, the
 * role variant and the user. Three roles, web channel, no audit of reads; the metadata of ALL classes is shown (the class decides the download only).
 */
import type { DocumentList } from '@evia/contracts';
import { zListCustomerDocumentsPath, zListSiteDocumentsPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory } from '../../catalog/index.ts';
import { CUSTOMER_DIRECTORY, type CustomerDirectory } from '../../customers/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { SITE_DIRECTORY, type SiteDirectory } from '../../sites/index.ts';
import { countDocuments, listDocuments, type DocumentPagePosition, type DocumentScope } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { presentDocuments } from './document-support.ts';
import { DEFAULT_LIMIT, listQuerySchema, positionSchema } from './list-documents.service.ts';

export const LIST_SITE_DOCUMENTS_OPERATION = 'listSiteDocuments';
export const LIST_CUSTOMER_DOCUMENTS_OPERATION = 'listCustomerDocuments';

const sitePathSchema = strictObjects(zListSiteDocumentsPath);
const customerPathSchema = strictObjects(zListCustomerDocumentsPath);

interface Anchor {
  readonly operation: string;
  /** The scope of the statement: the anchor column of the path and nothing else. */
  readonly scope: DocumentScope;
  /** The key of the anchor in the scope of the cursor. */
  readonly cursorScope: string;
}

@Injectable()
export class ListAnchoredDocumentsService {
  readonly #db: Kysely<Database>;
  readonly #cursors: CursorCodec;
  readonly #sites: SiteDirectory;
  readonly #customers: CustomerDirectory;
  readonly #kinds: DocumentKindDirectory;
  readonly #stages: ProcedureStageDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(SITE_DIRECTORY) sites: SiteDirectory,
    @Inject(CUSTOMER_DIRECTORY) customers: CustomerDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
  ) {
    this.#db = db;
    this.#cursors = cursors;
    this.#sites = sites;
    this.#customers = customers;
    this.#kinds = kinds;
    this.#stages = stages;
  }

  listForSite(principal: Principal, rawParams: unknown, rawQuery: unknown): Promise<DocumentList> {
    const { siteId } = parseInput(sitePathSchema, rawParams) as { siteId: string };
    return this.#list(
      principal,
      rawQuery,
      { operation: LIST_SITE_DOCUMENTS_OPERATION, scope: { siteId }, cursorScope: `site:${siteId}` },
      async (tx) => (await this.#sites.findVisible(tx, principal, siteId)) !== undefined,
    );
  }

  listForCustomer(principal: Principal, rawParams: unknown, rawQuery: unknown): Promise<DocumentList> {
    const { customerId } = parseInput(customerPathSchema, rawParams) as { customerId: string };
    return this.#list(
      principal,
      rawQuery,
      { operation: LIST_CUSTOMER_DOCUMENTS_OPERATION, scope: { customerId }, cursorScope: `customer:${customerId}` },
      async (tx) => (await this.#customers.findVisible(tx, principal, customerId)) !== undefined,
    );
  }

  async #list(
    principal: Principal,
    rawQuery: unknown,
    anchor: Anchor,
    visible: (tx: Kysely<Database>) => Promise<boolean>,
  ): Promise<DocumentList> {
    const query = parseInput(listQuerySchema, rawQuery);
    const limit = query.limit ?? DEFAULT_LIMIT;
    // `canDownload` depends on the role, so the cursor is bound to it as well as to the anchor
    const scope = scopeOf([anchor.cursorScope, `role:${principal.role}`]);
    const position = this.#positionOf(anchor.operation, query.cursor, principal, scope);

    return runInTransaction(
      this.#db,
      async (tx) => {
        if (!(await visible(tx))) throw new ProblemException('not_found');
        const tables = mediaTables(tx);
        const rows = await listDocuments(tables, anchor.scope, { limit, ...(position === undefined ? {} : { position }) });
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);
        const nextCursor =
          rows.length > limit && last !== undefined
            ? this.#cursors.seal(anchor.operation, {
                position: [last.document.created_at.toISOString(), last.document.id],
                scope,
                userId: principal.userId,
              })
            : null;
        return {
          items: await presentDocuments(tx, this.#kinds, this.#stages, principal.role, shown),
          nextCursor,
          totalCount: await countDocuments(tables, anchor.scope),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** @throws ProblemException `invalid_cursor` - one answer for every reason (SR-API-01) */
  #positionOf(operation: string, cursor: string | undefined, principal: Principal, scope: string): DocumentPagePosition | undefined {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(operation, cursor, { scope, userId: principal.userId });
    const parsed = parts === undefined ? undefined : positionSchema.safeParse(parts);
    if (parsed === undefined || !parsed.success) throw new ProblemException('invalid_cursor');
    return { createdAt: new Date(parsed.data[0]), id: parsed.data[1] };
  }
}
