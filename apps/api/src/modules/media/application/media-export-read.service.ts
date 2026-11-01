/**
 * The reading of the ZIP exports and the address of the finished archive (EVM-052 AC1, AC6, AC7; SR-FILE-07, SR-AUTHZ-05, SR-AUTHZ-06, SR-LOG-03; CWE-639, CWE-203,
 * CWE-285, CWE-362). An export is the property of the person who asked for it: the order of the path, the requester and the life are ONE condition of ONE
 * statement, so another Administrator, an Editor, Read-only, an export of another order, an expired and a missing one are the same `404` - the answer says
 * nothing about existence. The guard decided before this runs (the web channel, a role of the operation, CSRF).
 *
 * The address (`POST .../download-url`): the CURRENT role and account are checked at the moment of the call - the principal is read from the session of THIS
 * request, so an Editor demoted to Read-only (or whose account was deactivated) after the order gets `404` (`401` for an ended session), not the file. The export
 * is consumed in one conditional UPDATE (the link is issued once: of two concurrent calls exactly one wins), then the address is signed (300 s, the host of the
 * bucket of the exports, `application/zip`, an `attachment` named by the server from the number of the order, `no-store`) and the issue is audited - all in ONE
 * transaction: a failed signature or audit rolls the consumption back (fail closed, the user may press the button again). The address and the name are never
 * logged or audited.
 */
import type { MediaDerivativeUrl, MediaExport, MediaExportList } from '@evia/contracts';
import { zCreateMediaExportDownloadUrlPath, zGetMediaExportPath, zListMediaExportsPath } from '@evia/contracts/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { DERIVATIVE_URL_SECONDS, EXPORT_STORAGE, type ObjectStorage } from '../../../platform/object-storage/object-storage.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { archiveFileName } from '../domain/export-plan.ts';
import type { MediaAuditEvent } from '../events.ts';
import { consumeExport, findOwnExport, listOwnExports, type LiveExportRow } from '../infrastructure/export-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { requireStorage, viaStorage } from './media-support.ts';

const listPath = strictObjects(zListMediaExportsPath);
const getPath = strictObjects(zGetMediaExportPath);
const urlPath = strictObjects(zCreateMediaExportDownloadUrlPath);

/** Nothing is cached: the address is a short-lived secret (the answer is `no-store` as well). */
export const EXPORT_CACHE_CONTROL = 'private, no-store';

/** The API state of an export: the link already issued is `downloaded` (the row stays `ready` until the end of its life). */
function stateOf(row: LiveExportRow): MediaExport['state'] {
  return row.state === 'ready' && row.downloaded_at !== null ? 'downloaded' : row.state;
}

export function toMediaExport(row: LiveExportRow): MediaExport {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    state: stateOf(row),
    ...(row.file_count === null ? {} : { fileCount: row.file_count }),
    ...(row.size_bytes === null ? {} : { sizeBytes: Number(row.size_bytes) }),
    ...(row.failure_code === null || row.state !== 'failed' ? {} : { failureCode: row.failure_code }),
    createdAt: row.created_at.toISOString(),
    ...(row.ready_at === null ? {} : { readyAt: row.ready_at.toISOString() }),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** Only an Administrator and an Editor own exports: Read-only never does (P6) - checked on the CURRENT role of the session. */
const mayOwnExports = (principal: Principal): boolean => principal.role === 'administrator' || principal.role === 'editor';

@Injectable()
export class MediaExportReadService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #orders: WorkOrderDirectory;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(EXPORT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#orders = orders;
    this.#storage = storage;
  }

  async list(principal: Principal, rawParams: unknown): Promise<MediaExportList> {
    const { workOrderId } = parseInput(listPath, rawParams) as { workOrderId: string };
    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      if (!mayOwnExports(principal)) return { items: [] };
      const rows = await listOwnExports(mediaTables(tx), { workOrderId: order.id, userId: principal.userId, now: this.#clock.now() });
      return { items: rows.map(toMediaExport) };
    });
  }

  async get(principal: Principal, rawParams: unknown): Promise<MediaExport> {
    const { workOrderId, exportId } = parseInput(getPath, rawParams) as { workOrderId: string; exportId: string };
    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined || !mayOwnExports(principal)) throw new ProblemException('not_found');
      const row = await findOwnExport(mediaTables(tx), {
        exportId,
        workOrderId: order.id,
        userId: principal.userId,
        now: this.#clock.now(),
      });
      if (row === undefined) throw new ProblemException('not_found');
      return toMediaExport(row);
    });
  }

  async createDownloadUrl(principal: Principal, rawParams: unknown, context: EventContext): Promise<MediaDerivativeUrl> {
    const { workOrderId, exportId } = parseInput(urlPath, rawParams) as { workOrderId: string; exportId: string };
    const request = { ...context, sessionId: principal.sessionId };
    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined || !mayOwnExports(principal)) throw new ProblemException('not_found');
      const now = this.#clock.now();
      const key = await consumeExport(mediaTables(tx), { exportId, workOrderId: order.id, userId: principal.userId, now });
      if (key === undefined) throw new ProblemException('not_found');
      const storage = requireStorage(this.#storage);
      const number = (await this.#orders.refsOf(tx, principal, [order.id])).get(order.id)?.number ?? '';
      const signed = await viaStorage(() =>
        storage.presignGet({
          key,
          expiresInSeconds: DERIVATIVE_URL_SECONDS,
          contentType: 'application/zip',
          cacheControl: EXPORT_CACHE_CONTROL,
          disposition: { kind: 'attachment', filename: archiveFileName(number) },
        }),
      );
      const event: MediaAuditEvent = {
        type: 'media_export.downloaded',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'media_export',
        objectId: exportId,
      };
      await this.#events.publish(tx, event, request);
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    });
  }
}
