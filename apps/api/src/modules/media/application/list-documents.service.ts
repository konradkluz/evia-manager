/**
 * The list of the documents of an order (EVM-047 AC1, AC2, AC5, AC7, AC8; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-05, SR-API-02, SR-API-04). Three roles, web
 * channel, no audit of reads; the metadata of ALL classes is shown to every role (the class decides the download only, `canDownload`). The path and the
 * query are validated and the cursor opened (`400`) BEFORE the database; the order is then resolved through the read policy (`404`). ONE statement reads
 * the page with the version and the file of each document; the kinds of the page are read ONCE through the catalog facade (no N+1). The cursor is opaque,
 * bound to the order, the role variant and the user, and expires.
 */
import type { DocumentList } from '@evia/contracts';
import { zListDocumentsPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { DOCUMENT_KIND_DIRECTORY, type DocumentKindDirectory } from '../../catalog/index.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { PROCEDURE_STAGE_DIRECTORY, type ProcedureStageDirectory } from '../../procedures/index.ts';
import { countDocuments, listDocuments, type DocumentPagePosition } from '../infrastructure/document-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { presentDocuments } from './document-support.ts';

export const LIST_DOCUMENTS_OPERATION = 'listDocuments';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const pathSchema = strictObjects(zListDocumentsPath);
const querySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(MAX_LIMIT))
    .optional(),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

const positionSchema = z.tuple([z.iso.datetime(), z.uuid()]);

@Injectable()
export class ListDocumentsService {
  readonly #db: Kysely<Database>;
  readonly #stages: ProcedureStageDirectory;
  readonly #cursors: CursorCodec;
  readonly #orders: WorkOrderDirectory;
  readonly #kinds: DocumentKindDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(DOCUMENT_KIND_DIRECTORY) kinds: DocumentKindDirectory,
    @Inject(PROCEDURE_STAGE_DIRECTORY) stages: ProcedureStageDirectory,
  ) {
    this.#stages = stages;
    this.#db = db;
    this.#cursors = cursors;
    this.#orders = orders;
    this.#kinds = kinds;
  }

  async list(principal: Principal, rawParams: unknown, rawQuery: unknown): Promise<DocumentList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const query = parseInput(querySchema, rawQuery);
    const limit = query.limit ?? DEFAULT_LIMIT;
    // `canDownload` depends on the role, so the cursor is bound to it (a cursor of one role never opens a page of another)
    const scope = scopeOf([workOrderId, `role:${principal.role}`]);
    const position = this.#positionOf(query.cursor, principal, scope);

    return runInTransaction(
      this.#db,
      async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const tables = mediaTables(tx);
        const rows = await listDocuments(tables, order.id, { limit, ...(position === undefined ? {} : { position }) });
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);
        const nextCursor =
          rows.length > limit && last !== undefined
            ? this.#cursors.seal(LIST_DOCUMENTS_OPERATION, {
                position: [last.document.created_at.toISOString(), last.document.id],
                scope,
                userId: principal.userId,
              })
            : null;
        return {
          items: await presentDocuments(tx, this.#kinds, this.#stages, principal.role, shown),
          nextCursor,
          totalCount: await countDocuments(tables, order.id),
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** @throws ProblemException `invalid_cursor` - one answer for every reason (SR-API-01) */
  #positionOf(cursor: string | undefined, principal: Principal, scope: string): DocumentPagePosition | undefined {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_DOCUMENTS_OPERATION, cursor, { scope, userId: principal.userId });
    const parsed = parts === undefined ? undefined : positionSchema.safeParse(parts);
    if (parsed === undefined || !parsed.success) throw new ProblemException('invalid_cursor');
    return { createdAt: new Date(parsed.data[0]), id: parsed.data[1] };
  }
}
