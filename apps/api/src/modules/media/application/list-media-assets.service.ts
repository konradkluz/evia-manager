/**
 * The list of the media of an order (EVM-044 AC1, AC4, AC7; SR-AUTHZ-02, SR-AUTHZ-03, SR-AUTHZ-05, SR-API-02, SR-API-04). Three roles, web
 * channel, no audit of reads. The path and the query are validated and the cursor opened (`400`) BEFORE the database; the order is then
 * resolved through the read policy (`404`). ONE statement reads the page with the state of every file (no N+1). The cursor is opaque,
 * bound to the filter, the order and the user, and expires. With `uploadState=unfinished` only the unfinished uploads of the CALLER are
 * returned - those with an active, unexpired session (the condition is in the join, not a filter of the page) and the files of the caller
 * still in `pending_upload` without one (an interrupted batch: the session expired, was aborted or never opened) - and only those carry
 * the file name and, when there is one, the session (AC4: "Nie wysłano N zdjęć — wybierz je ponownie z galerii"). Nothing returned names the object key or the
 * checksum. EVM-049: `needsAttention=true` lists only the files held in quarantine (AC6) and `needsAttentionCount` counts them for the order
 * (every role, the same rule as the filter); the REASON of a quarantine is part of an item only when the caller may manage the quarantine
 * (`canManageQuarantine`, the policy `mediaQuarantine.manage` of the contract), and the cursor is bound to the filter and to that variant.
 */
import type { MediaAssetList } from '@evia/contracts';
import { zListMediaAssetsPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Clock } from '../../../platform/clock/clock.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, CURSOR_CODEC, DATABASE } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { canManageQuarantine } from '../../authorization/index.ts';
import { countHeld, listAssets, type PagePosition } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { creatorOf, toMediaAsset } from './media-support.ts';

export const LIST_MEDIA_OPERATION = 'listMediaAssets';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const pathSchema = strictObjects(zListMediaAssetsPath);
const querySchema = z.strictObject({
  uploadState: z.literal('unfinished').optional(),
  needsAttention: z.enum(['true', 'false']).optional(),
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
export class ListMediaAssetsService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #cursors: CursorCodec;
  readonly #orders: WorkOrderDirectory;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#cursors = cursors;
    this.#orders = orders;
  }

  async list(principal: Principal, rawParams: unknown, rawQuery: unknown): Promise<MediaAssetList> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const query = parseInput(querySchema, rawQuery);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const unfinished = query.uploadState === 'unfinished';
    const attention = query.needsAttention === 'true';
    const manageQuarantine = canManageQuarantine(principal);
    const scope = scopeOf([
      workOrderId,
      query.uploadState ?? '',
      attention ? 'attention' : '',
      manageQuarantine ? 'variant:with-reason' : 'variant:without-reason',
    ]);
    const position = this.#positionOf(query.cursor, principal, scope);

    return runInTransaction(
      this.#db,
      async (tx) => {
        const order = await this.#orders.findVisible(tx, principal, workOrderId);
        if (order === undefined) throw new ProblemException('not_found');
        const rows = await listAssets(mediaTables(tx), order.id, {
          creator: creatorOf(principal),
          unfinishedOnly: unfinished,
          attentionOnly: attention,
          now: this.#clock.now(),
          limit,
          ...(position === undefined ? {} : { position }),
        });
        const shown = rows.slice(0, limit);
        const last = shown.at(-1);
        const nextCursor =
          rows.length > limit && last !== undefined
            ? this.#cursors.seal(LIST_MEDIA_OPERATION, {
                position: [last.asset.created_at.toISOString(), last.asset.id],
                scope,
                userId: principal.userId,
              })
            : null;
        const needsAttentionCount = await countHeld(mediaTables(tx), order.id);
        return {
          items: shown.map((row) => toMediaAsset(row, { unfinished, session: row.session, manageQuarantine })),
          nextCursor,
          needsAttentionCount,
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /** @throws ProblemException `invalid_cursor` — one answer for every reason (SR-API-01) */
  #positionOf(cursor: string | undefined, principal: Principal, scope: string): PagePosition | undefined {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_MEDIA_OPERATION, cursor, { scope, userId: principal.userId });
    const parsed = parts === undefined ? undefined : positionSchema.safeParse(parts);
    if (parsed === undefined || !parsed.success) throw new ProblemException('invalid_cursor');
    return { createdAt: new Date(parsed.data[0]), id: parsed.data[1] };
  }
}
