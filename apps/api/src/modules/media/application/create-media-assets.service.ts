/**
 * "Wyślij N plików", step 1 — a batch of media with their files in `pending_upload` (EVM-044 AC1, AC2, AC7; SR-AUTHZ-02, SR-AUTHZ-05,
 * SR-INPUT-01, SR-FILE-01, SR-FILE-02, SR-FILE-03, SR-API-05, SR-API-06, SR-LOG-03). The guard has decided before this runs: a signed-in
 * Administrator or Editor on the web channel with a valid CSRF token — Read-only gets 403 and an anonymous caller 401 without reaching
 * the headers, the body or the table of idempotency records.
 *
 * ONE transaction. The order: the path (`400`); the order of the path through the read policy (`404`: missing and deleted alike, before
 * the headers and the body); the storage is configured (`503`, fail closed); the `Idempotency-Key` and the strict body — the type,
 * the extension and the size of every file against the allow-list (`400`, pointers `/items/N/…`, codes, never values); the idempotency
 * port (a repeat returns the stored result BEFORE the writes; the key is bound to the ORDER); then for every item the INSERT of the
 * medium (an identifier that exists — in any order, of any user — is `409 id_conflict`, nothing of it is read) and of its file (the key of
 * the object is assigned HERE: `media/{year}/{month}/{id of the file}/original`), ONE journal event for the batch (the count and the
 * identifiers), one audit event per medium. An order that is closed still accepts media ("nic nie ginie", PO-8). An error anywhere
 * rolls the whole command back.
 */
import type { MediaAssetBatch } from '@evia/contracts';
import { zCreateMediaAssetsBody, zCreateMediaAssetsPath } from '@evia/contracts/zod';
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
import { WORK_ORDER_DIRECTORY, type WorkOrderDirectory } from '../../work-orders/index.ts';
import { checkDeclaration } from '../domain/file-rules.ts';
import { objectKeyFor } from '../domain/upload-plan.ts';
import type { MediaAssetsAddedEvent, MediaAuditEvent } from '../events.ts';
import { findAssetsWithFiles, insertMediaAsset, insertStoredFile, newFileIds } from '../infrastructure/media-store.ts';
import { mediaTables } from '../infrastructure/tables.ts';
import { idempotencyKeyOf, requireStorage, toMediaAsset } from './media-support.ts';

export const CREATE_MEDIA_SCOPE = 'POST /api/v1/work-orders/{workOrderId}/media-assets';
const scopeOf = (workOrderId: string): string => CREATE_MEDIA_SCOPE.replace('{workOrderId}', workOrderId);

const pathSchema = strictObjects(zCreateMediaAssetsPath);
const bodySchema = strictObjects(zCreateMediaAssetsBody);
/** Fields of the server the client names in vain (`read_only_field` at the root; nested ones are unknown fields). */
const SERVER_FIELDS: ReadonlySet<string> = new Set(['workOrderId', 'mediaType', 'origin', 'fileState', 'createdAt', 'objectKey']);

interface Item {
  readonly id: string;
  readonly category: string;
  readonly description?: string | undefined;
  readonly fileName: string;
  readonly declaredSize: number;
  readonly contentType: string;
  readonly sha256: string;
}

export interface CreatedMedia {
  readonly batch: MediaAssetBatch;
  readonly replayed: boolean;
}

@Injectable()
export class CreateMediaAssetsService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #idempotency: Idempotency;
  readonly #orders: WorkOrderDirectory;
  readonly #storage: ObjectStorage | null;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(IDEMPOTENCY) idempotency: Idempotency,
    @Inject(WORK_ORDER_DIRECTORY) orders: WorkOrderDirectory,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage | null,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#idempotency = idempotency;
    this.#orders = orders;
    this.#storage = storage;
  }

  async create(
    principal: Principal,
    rawParams: unknown,
    rawBody: unknown,
    rawKey: string | undefined,
    context: EventContext,
  ): Promise<CreatedMedia> {
    const { workOrderId } = parseInput(pathSchema, rawParams) as { workOrderId: string };
    const request = { ...context, sessionId: principal.sessionId };

    return runInTransaction(this.#db, async (tx) => {
      const order = await this.#orders.findVisible(tx, principal, workOrderId);
      if (order === undefined) throw new ProblemException('not_found');
      requireStorage(this.#storage);
      const key = idempotencyKeyOf(rawKey);
      const items = parseItems(rawBody);

      const perform = async () => {
        await this.#add(tx, principal, order.id, items, request);
        return { value: undefined, result: { status: 201, code: 'created', resourceId: items[0]?.id ?? null } };
      };
      const { replayed } = await this.#idempotency.run(
        tx,
        { userId: principal.userId, deviceId: null, key, scope: scopeOf(order.id), bodyHash: requestHash({ items }) },
        perform,
      );
      // read again with the order of the URL in the condition: a repeat never names a medium of another order
      const rows = await findAssetsWithFiles(
        mediaTables(tx),
        order.id,
        items.map((item) => item.id),
      );
      return { batch: { items: rows.map((row) => toMediaAsset(row)) }, replayed };
    });
  }

  async #add(
    tx: Kysely<Database>,
    principal: Principal,
    workOrderId: string,
    items: readonly Item[],
    request: EventContext,
  ): Promise<void> {
    const now = this.#clock.now();
    const tables = mediaTables(tx);
    const fileIds = await newFileIds(tables, items.length);
    for (const [index, item] of items.entries()) {
      const declaration = checkDeclaration(item);
      /* v8 ignore next -- parseItems already refused every item that does not pass */
      if (!declaration.ok) throw new ProblemException('validation_failed');
      const inserted = await insertMediaAsset(
        tables,
        { id: item.id, workOrderId, category: item.category, description: item.description ?? null, createdBy: principal.userId },
        now,
      );
      if (!inserted) throw new ProblemException('id_conflict');
      const fileId = fileIds[index] as string;
      await insertStoredFile(
        tables,
        {
          id: fileId,
          mediaAssetId: item.id,
          objectKey: objectKeyFor(fileId, now),
          declaredSize: item.declaredSize,
          declaredContentType: declaration.value.contentType,
          declaredSha256: item.sha256,
          originalFilename: declaration.value.originalFilename,
          createdBy: principal.userId,
        },
        now,
      );
    }
    const added: MediaAssetsAddedEvent = {
      type: 'media.assets_added',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      workOrderId,
      mediaAssetIds: items.map((item) => item.id),
    };
    await this.#events.publish(tx, added, request);
    for (const item of items) {
      const audited: MediaAuditEvent = {
        type: 'media_asset.created',
        actor: { type: 'user', userId: principal.userId },
        outcome: 'success',
        objectType: 'media_asset',
        objectId: item.id,
      };
      await this.#events.publish(tx, audited, request);
    }
  }
}

/** The body against the strict schema of the contract, then the type, the extension and the size of every file (`400`, pointers, codes). */
function parseItems(rawBody: unknown): Item[] {
  const body = parseInput(bodySchema, rawBody, SERVER_FIELDS) as { items: Item[] };
  const errors: Array<{ pointer: string; code: string }> = [];
  const seen = new Set<string>();
  for (const [index, item] of body.items.entries()) {
    if (seen.has(item.id)) errors.push({ pointer: `/items/${index}/id`, code: 'duplicate' });
    seen.add(item.id);
    const declaration = checkDeclaration(item);
    if (!declaration.ok)
      for (const issue of declaration.issues) errors.push({ pointer: `/items/${index}/${issue.field}`, code: issue.code });
  }
  if (errors.length > 0) throw new ProblemException('validation_failed', { errors });
  return body.items;
}
