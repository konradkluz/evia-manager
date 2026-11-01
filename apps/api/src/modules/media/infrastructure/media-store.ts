/**
 * Queries of the `media` module (EVM-044). Every read that leads to an object starts from the order of the path AND the caller, in ONE
 * statement (SR-AUTHZ-02, CWE-639): a medium of another order, a session of another user or device is simply not found. Nothing here
 * selects the object key, the checksum or the S3 upload id except where the service must use them (`storageRefs`) — and the
 * representation never returns them.
 */
import { sql, type Selectable } from 'kysely';
import { QUARANTINE_RETENTION_DAYS } from '../domain/quarantine.ts';
import type { FileState, ReasonCode } from '../domain/scan-outcome.ts';
import type { DerivativeVariant } from '../domain/derivatives.ts';
import { findDocumentWithFile, type DocumentScope, type DocumentWithFile } from './document-store.ts';
import type { MediaDb, MediaAssetsTable, StoredFilesTable, UploadSessionsTable } from './tables.ts';

export type StoredFileRow = Selectable<StoredFilesTable>;
export type MediaAssetRow = Selectable<MediaAssetsTable>;
export type UploadSessionRow = Selectable<UploadSessionsTable>;

/** The creator of a session: the user and the device (`null` for the web, which has none). */
export interface Creator {
  readonly userId: string;
  readonly deviceId: string | null;
}

export interface NewMediaAsset {
  readonly id: string;
  readonly workOrderId: string;
  readonly mediaType: 'photo' | 'video';
  readonly category: string;
  readonly description: string | null;
  readonly procedureStageId?: string | null;
  readonly createdBy: string;
}

export interface NewStoredFile {
  readonly id: string;
  readonly mediaAssetId: string;
  readonly objectKey: string;
  readonly declaredSize: number;
  readonly declaredContentType: string;
  readonly declaredSha256: string;
  readonly originalFilename: string;
  readonly createdBy: string;
}

/** @returns whether the medium was inserted (`false`: the identifier is taken — by anyone; nothing of the existing row is read) */
export async function insertMediaAsset(db: MediaDb, asset: NewMediaAsset, now: Date): Promise<boolean> {
  const result = await db
    .insertInto('media.media_assets')
    .values({
      id: asset.id,
      work_order_id: asset.workOrderId,
      procedure_stage_id: asset.procedureStageId ?? null,
      media_type: asset.mediaType,
      category: asset.category,
      description: asset.description,
      origin: 'web',
      captured_at: null,
      created_at: now,
      created_by: asset.createdBy,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

export async function insertStoredFile(db: MediaDb, file: NewStoredFile, now: Date): Promise<void> {
  await db
    .insertInto('media.stored_files')
    .values({
      id: file.id,
      purpose: 'media_original',
      media_asset_id: file.mediaAssetId,
      object_key: file.objectKey,
      state: 'pending_upload',
      state_reason_code: null,
      state_changed_at: now,
      scan_claimed_at: null,
      declared_size_bytes: String(file.declaredSize),
      size_bytes: null,
      declared_content_type: file.declaredContentType,
      content_type: null,
      declared_sha256: file.declaredSha256,
      sha256: null,
      original_filename: file.originalFilename,
      s3_version_id: null,
      s3_etag: null,
      quarantined_at: null,
      purged_at: null,
      created_at: now,
      created_by: file.createdBy,
    })
    .execute();
}

export interface AssetWithFile {
  readonly asset: MediaAssetRow;
  readonly file: StoredFileRow;
  /** The deadline of the quarantine from the database function (the one expression of the sweeper and the API); `null` for a file never in it. */
  readonly quarantineExpiresAt: Date | null;
}

/** `media.quarantine_expires_at` of the file `f`: the start of the business day of the first entry plus 30 calendar days (migration 0046). */
const quarantineExpiry = sql<Date | null>`media.quarantine_expires_at(f.quarantined_at, ${QUARANTINE_RETENTION_DAYS}::integer)`.as(
  'quarantine_expires_at',
);

/** The file is stopped in quarantine and not yet purged: a new scan has taken it or it waits (`quarantined`, or `scanning` with the first entry set). */
const HELD = sql<boolean>`(f.quarantined_at is not null and f.purged_at is null and f.state in ('quarantined', 'scanning'))`;

/** The medium of THIS order with its file, row-locked when `lock` (the state decides what may be done to it). */
export async function findAssetWithFile(
  db: MediaDb,
  workOrderId: string,
  mediaAssetId: string,
  lock = false,
  /** Only the restore and the erasure of a file reach a medium that is soft deleted (EVM-051): every other reader never sees it (SR-AUTHZ-02). */
  includeDeleted = false,
): Promise<AssetWithFile | undefined> {
  const visible = db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.id', '=', mediaAssetId)
    .where('a.work_order_id', '=', workOrderId);
  const base = (includeDeleted ? visible : visible.where('a.deleted_at', 'is', null))
    .selectAll('f')
    .select([
      'a.id as a_id',
      'a.work_order_id as a_work_order_id',
      'a.procedure_stage_id as a_procedure_stage_id',
      'a.media_type as a_media_type',
      'a.category as a_category',
      'a.description as a_description',
      'a.origin as a_origin',
      'a.captured_at as a_captured_at',
      'a.created_at as a_created_at',
      'a.created_by as a_created_by',
      'a.updated_at as a_updated_at',
      'a.version as a_version',
      'a.updated_by as a_updated_by',
      'a.deleted_at as a_deleted_at',
      'a.deleted_by as a_deleted_by',
      'a.file_purged_at as a_file_purged_at',
      quarantineExpiry,
    ]);
  const row = await (lock ? base.forNoKeyUpdate('f') : base).executeTakeFirst();
  return row === undefined ? undefined : splitRow(row);
}

export type JoinedRow = StoredFileRow & {
  a_id: string;
  a_work_order_id: string;
  a_procedure_stage_id: string | null;
  a_media_type: 'photo' | 'video';
  a_category: string;
  a_description: string | null;
  a_origin: 'web' | 'mobile';
  a_captured_at: Date | null;
  a_created_at: Date;
  a_created_by: string;
  a_updated_at: Date;
  a_version: number;
  a_updated_by: string | null;
  a_deleted_at: Date | null;
  a_deleted_by: string | null;
  a_file_purged_at: Date | null;
  quarantine_expires_at: Date | null;
};

export function splitRow(row: JoinedRow): AssetWithFile {
  const {
    a_id,
    a_work_order_id,
    a_procedure_stage_id,
    a_media_type,
    a_category,
    a_description,
    a_origin,
    a_captured_at,
    a_created_at,
    a_created_by,
    a_updated_at,
    a_version,
    a_updated_by,
    a_deleted_at,
    a_deleted_by,
    a_file_purged_at,
    quarantine_expires_at,
    ...file
  } = row;
  return {
    file,
    quarantineExpiresAt: quarantine_expires_at,
    asset: {
      id: a_id,
      work_order_id: a_work_order_id,
      procedure_stage_id: a_procedure_stage_id,
      media_type: a_media_type,
      category: a_category,
      description: a_description,
      origin: a_origin,
      captured_at: a_captured_at,
      created_at: a_created_at,
      created_by: a_created_by,
      updated_at: a_updated_at,
      version: a_version,
      updated_by: a_updated_by,
      deleted_at: a_deleted_at,
      deleted_by: a_deleted_by,
      file_purged_at: a_file_purged_at,
    },
  };
}

/** The owner of an uploaded file, named by the PATH of the request: a medium or a document (the path decides, never the data). */
export type OwnerRef = { readonly kind: 'media_asset'; readonly id: string } | { readonly kind: 'document'; readonly id: string };

export type Owned =
  { readonly kind: 'media_asset'; readonly found: AssetWithFile } | { readonly kind: 'document'; readonly found: DocumentWithFile };

/**
 * The owner of THIS order with its file, in ONE statement, by the kind the path names (EVM-047): a document used through the path of the media - and the
 * other way round - is not found, the same absence as a missing one.
 */
export async function findOwnerWithFile(
  db: MediaDb,
  workOrderId: string,
  owner: OwnerRef,
  lock = false,
  documentScope: DocumentScope = { workOrderId },
): Promise<Owned | undefined> {
  if (owner.kind === 'media_asset') {
    // a MEDIUM is reached through its own order only: the wider scope of the documents (EVM-050) never applies to it (SR-AUTHZ-08)
    const found = await findAssetWithFile(db, workOrderId, owner.id, lock);
    return found === undefined ? undefined : { kind: 'media_asset', found };
  }
  const found = await findDocumentWithFile(db, documentScope, owner.id, lock);
  return found === undefined ? undefined : { kind: 'document', found };
}

export const fileOfOwner = (owned: Owned): StoredFileRow => owned.found.file;
/** The user who created the owner: only they (or an Administrator) open a session on it. */
export const creatorOfOwner = (owned: Owned): string =>
  owned.kind === 'media_asset' ? owned.found.asset.created_by : owned.found.document.created_by;

export interface SessionChain {
  readonly owned: Owned;
  readonly file: StoredFileRow;
  readonly session: UploadSessionRow;
}

/**
 * The chain order → owner → file → session in ONE statement, with the creator in the condition (AC6, AC7): another user's session,
 * another device's, a session of another owner or order and a missing one are all the same absence.
 */
export async function findSessionChain(
  db: MediaDb,
  ids: { readonly workOrderId: string; readonly owner: OwnerRef; readonly sessionId: string; readonly documentScope?: DocumentScope },
  creator: Creator,
  lock = false,
): Promise<SessionChain | undefined> {
  const owned = await findOwnerWithFile(db, ids.workOrderId, ids.owner, lock, ids.documentScope);
  if (owned === undefined) return undefined;
  const file = fileOfOwner(owned);
  const base = db
    .selectFrom('media.upload_sessions')
    .where('id', '=', ids.sessionId)
    .where('stored_file_id', '=', file.id)
    .where('user_id', '=', creator.userId)
    .where(sql<boolean>`device_id is not distinct from ${creator.deviceId}`)
    .selectAll();
  const session = await (lock ? base.forUpdate() : base).executeTakeFirst();
  return session === undefined ? undefined : { owned, file, session };
}

/** The active session of a file, whoever made it (at most one: a partial unique index). */
export async function findActiveSession(db: MediaDb, storedFileId: string): Promise<UploadSessionRow | undefined> {
  return db
    .selectFrom('media.upload_sessions')
    .where('stored_file_id', '=', storedFileId)
    .where('state', '=', 'active')
    .selectAll()
    .forUpdate()
    .executeTakeFirst();
}

export async function countActiveSessions(db: MediaDb, userId: string, now: Date): Promise<number> {
  const row = await db
    .selectFrom('media.upload_sessions')
    .where('user_id', '=', userId)
    .where('state', '=', 'active')
    .where('expires_at', '>', now)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** @returns whether the identifier of the session is free; a taken one is `409 id_conflict` without reading the row */
export async function insertSession(
  db: MediaDb,
  session: {
    readonly id: string;
    readonly storedFileId: string;
    readonly creator: Creator;
    readonly s3UploadId: string;
    readonly partSize: number;
    readonly partCount: number;
    readonly expiresAt: Date;
  },
  now: Date,
): Promise<boolean> {
  const result = await db
    .insertInto('media.upload_sessions')
    .values({
      id: session.id,
      stored_file_id: session.storedFileId,
      user_id: session.creator.userId,
      device_id: session.creator.deviceId,
      s3_upload_id: session.s3UploadId,
      part_size_bytes: String(session.partSize),
      part_count: session.partCount,
      state: 'active',
      expires_at: session.expiresAt,
      created_at: now,
      updated_at: now,
    })
    .onConflict((conflict) => conflict.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

export async function setSessionState(
  db: MediaDb,
  sessionId: string,
  from: UploadSessionRow['state'],
  to: UploadSessionRow['state'],
  now: Date,
): Promise<boolean> {
  const result = await db
    .updateTable('media.upload_sessions')
    .set({ state: to, updated_at: now })
    .where('id', '=', sessionId)
    .where('state', '=', from)
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

/** Compare-and-set of the state of a file: moves only from `from` (a second worker or a repeat finds nothing to do). */
export async function transitionFile(
  db: MediaDb,
  storedFileId: string,
  from: FileState | readonly FileState[],
  to: {
    readonly state: FileState;
    readonly reason?: ReasonCode | null;
    readonly sizeBytes?: number | null;
    readonly contentType?: string | null;
    readonly sha256?: string | null;
    readonly s3VersionId?: string | null;
    readonly s3Etag?: string | null;
    /** Set EXPLICITLY by the scan: `true` after the antivirus, `false` for a video above the scan limit (P5). Never defaulted. */
    readonly avScanned?: boolean;
    /** The FIRST entry into quarantine (kept when already set: the column is write-once and the clock of the retention). */
    readonly quarantinedAt?: Date;
  },
  now: Date,
): Promise<boolean> {
  const froms = Array.isArray(from) ? [...(from as readonly FileState[])] : [from as FileState];
  const result = await db
    .updateTable('media.stored_files')
    .set({
      state: to.state,
      state_reason_code: to.reason ?? null,
      state_changed_at: now,
      ...(to.sizeBytes === undefined ? {} : { size_bytes: to.sizeBytes === null ? null : String(to.sizeBytes) }),
      ...(to.contentType === undefined ? {} : { content_type: to.contentType }),
      ...(to.sha256 === undefined ? {} : { sha256: to.sha256 }),
      ...(to.s3VersionId === undefined ? {} : { s3_version_id: to.s3VersionId }),
      ...(to.s3Etag === undefined ? {} : { s3_etag: to.s3Etag }),
      ...(to.avScanned === undefined ? {} : { av_scanned: to.avScanned }),
      ...(to.quarantinedAt === undefined ? {} : { quarantined_at: sql<Date>`coalesce(quarantined_at, ${to.quarantinedAt}::timestamptz)` }),
    })
    .where('id', '=', storedFileId)
    .where('state', 'in', froms)
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

export interface ListedAsset extends AssetWithFile {
  /** The active, unexpired session of the CALLER (the join carries the caller), else `null`. */
  readonly session: { readonly id: string; readonly expiresAt: Date; readonly partSize: number; readonly partCount: number } | null;
}

export interface PagePosition {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * One page of the media of an order, ONE statement with the state of the file (no N+1). With `unfinishedOnly` only the unfinished uploads of
 * THAT creator (the condition is in the join and the where, AC4): the media with an active, unexpired session of the creator AND the files
 * of the creator still in `pending_upload` without such a session (an interrupted batch: the session expired, was aborted or never
 * opened) - the whole batch is counted and chosen again, so no duplicate medium is made. `limit + 1` rows come back so the caller knows
 * whether there is a next page.
 */
export async function listAssets(
  db: MediaDb,
  workOrderId: string,
  options: {
    readonly creator: Creator;
    readonly unfinishedOnly: boolean;
    /** Only the files held in quarantine ("Wymaga uwagi", EVM-049 AC6). */
    readonly attentionOnly?: boolean;
    readonly now: Date;
    readonly position?: PagePosition;
    readonly limit: number;
  },
): Promise<ListedAsset[]> {
  const { creator, position } = options;
  let query = db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .leftJoin('media.upload_sessions as s', (join) =>
      join
        .onRef('s.stored_file_id', '=', 'f.id')
        .on('s.state', '=', 'active')
        .on('s.expires_at', '>', options.now)
        .on('s.user_id', '=', creator.userId)
        .on(sql<boolean>`s.device_id is not distinct from ${creator.deviceId}`),
    )
    .where('a.work_order_id', '=', workOrderId)
    .where('a.deleted_at', 'is', null);
  if (options.unfinishedOnly) {
    query = query.where((eb) =>
      eb.or([
        eb('s.id', 'is not', null),
        // an interrupted batch, or an upload the sweeper gave up (`abandoned`, EVM-049): the creator picks the file again and resumes
        eb.and([
          eb.or([
            eb('f.state', '=', 'pending_upload'),
            eb.and([eb('f.state', '=', 'failed'), eb('f.state_reason_code', '=', 'abandoned')]),
          ]),
          eb('f.created_by', '=', creator.userId),
        ]),
      ]),
    );
  }
  if (options.attentionOnly === true) query = query.where(HELD);
  if (position !== undefined) query = query.where(sql<boolean>`(a.created_at, a.id) < (${position.createdAt}, ${position.id})`);
  const rows = await query
    .selectAll('f')
    .select([
      'a.id as a_id',
      'a.work_order_id as a_work_order_id',
      'a.procedure_stage_id as a_procedure_stage_id',
      'a.media_type as a_media_type',
      'a.category as a_category',
      'a.description as a_description',
      'a.origin as a_origin',
      'a.captured_at as a_captured_at',
      'a.created_at as a_created_at',
      'a.created_by as a_created_by',
      'a.updated_at as a_updated_at',
      'a.version as a_version',
      'a.updated_by as a_updated_by',
      'a.deleted_at as a_deleted_at',
      'a.deleted_by as a_deleted_by',
      'a.file_purged_at as a_file_purged_at',
      quarantineExpiry,
      's.id as s_id',
      's.expires_at as s_expires_at',
      's.part_size_bytes as s_part_size_bytes',
      's.part_count as s_part_count',
    ])
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(options.limit + 1)
    .execute();
  return rows.map((row) => {
    const { s_id, s_expires_at, s_part_size_bytes, s_part_count, ...rest } = row;
    const split = splitRow(rest);
    const session =
      s_id === null || s_expires_at === null || s_part_size_bytes === null || s_part_count === null
        ? null
        : { id: s_id, expiresAt: s_expires_at, partSize: Number(s_part_size_bytes), partCount: s_part_count };
    return { ...split, session };
  });
}

/**
 * The files waiting for a scan: `uploaded`, `scanning` that no worker has claimed (a new scan was asked for, EVM-049) or `scanning` claimed
 * before `staleBefore` (a worker died or clamd was down), oldest first.
 */
export async function findUnscanned(db: MediaDb, staleBefore: Date, limit: number): Promise<Array<{ id: string }>> {
  return db
    .selectFrom('media.stored_files')
    .where('erased_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('state', '=', 'uploaded'),
        eb.and([eb('state', '=', 'scanning'), sql<boolean>`(scan_claimed_at is null or scan_claimed_at < ${staleBefore})`]),
      ]),
    )
    .orderBy('state_changed_at', 'asc')
    .limit(limit)
    .select('id')
    .execute();
}

/** Files still unscanned after `olderThan` — the count for the warning of the worker (SR-ERR-02: nothing stays silent). */
export async function countStuck(db: MediaDb, olderThan: Date): Promise<number> {
  const row = await db
    .selectFrom('media.stored_files')
    .where('state', 'in', ['uploaded', 'scanning'])
    .where('state_changed_at', '<', olderThan)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** The media with the given identifiers of THIS order, in ONE statement (the answer of a batch and its replay). */
export async function findAssetsWithFiles(db: MediaDb, workOrderId: string, ids: readonly string[]): Promise<AssetWithFile[]> {
  const rows = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.work_order_id', '=', workOrderId)
    .where('a.deleted_at', 'is', null)
    .where('a.id', 'in', [...ids])
    .selectAll('f')
    .select([
      'a.id as a_id',
      'a.work_order_id as a_work_order_id',
      'a.procedure_stage_id as a_procedure_stage_id',
      'a.media_type as a_media_type',
      'a.category as a_category',
      'a.description as a_description',
      'a.origin as a_origin',
      'a.captured_at as a_captured_at',
      'a.created_at as a_created_at',
      'a.created_by as a_created_by',
      'a.updated_at as a_updated_at',
      'a.version as a_version',
      'a.updated_by as a_updated_by',
      'a.deleted_at as a_deleted_at',
      'a.deleted_by as a_deleted_by',
      'a.file_purged_at as a_file_purged_at',
      quarantineExpiry,
    ])
    .execute();
  const byId = new Map(rows.map((row) => [row.a_id, splitRow(row)]));
  return ids.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });
}

/** Identifiers of new files, generated by the database (UUIDv7) in ONE statement — the key of an object needs the id before the row exists. */
export async function newFileIds(db: MediaDb, count: number): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`select uuidv7() as id from generate_series(1, ${count}::int)`.execute(db);
  return rows.map((row) => row.id);
}

/**
 * Takes a file for a scan: `uploaded` at once, `scanning` only when nobody has touched it since `staleBefore` (a worker died or the scanner was
 * unreachable). One worker wins; the others get `undefined` (compare-and-set, ADR-0010: the handler is idempotent).
 */
export async function claimForScan(db: MediaDb, storedFileId: string, staleBefore: Date, now: Date): Promise<StoredFileRow | undefined> {
  return db
    .updateTable('media.stored_files')
    .set({
      state: 'scanning',
      scan_claimed_at: now,
      state_changed_at: sql<Date>`case when state = 'uploaded' then ${now}::timestamptz else state_changed_at end`,
    })
    .where('id', '=', storedFileId)
    .where('erased_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('state', '=', 'uploaded'),
        eb.and([eb('state', '=', 'scanning'), sql<boolean>`(scan_claimed_at is null or scan_claimed_at < ${staleBefore})`]),
      ]),
    )
    .returningAll()
    .executeTakeFirst();
}

/** The order a medium belongs to (for the link of an alert and the audit); `undefined` for a file that has no medium. */
export async function workOrderOfAsset(db: MediaDb, mediaAssetId: string): Promise<string | undefined> {
  const row = await db.selectFrom('media.media_assets').where('id', '=', mediaAssetId).select('work_order_id').executeTakeFirst();
  return row?.work_order_id;
}

/** How many files of the order are held in quarantine (the counter of the filter, EVM-049 AC6): the same rule as the filter itself. */
export async function countHeld(db: MediaDb, workOrderId: string): Promise<number> {
  const row = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.work_order_id', '=', workOrderId)
    .where('a.deleted_at', 'is', null)
    .where(HELD)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * The new scan of a quarantined file (EVM-049 AC3): `quarantined` to `scanning` - and only while the file is not purged and its deadline has
 * not passed (the compare-and-set carries both, so a rescan never races the retention). The reason is cleared (the CHECK of 0046 wants no
 * reason outside `failed`/`quarantined`), the claim is cleared (the loop of the worker takes the file at once) and `quarantined_at` stays.
 * @returns whether the file was taken
 */
export async function requestRescan(db: MediaDb, storedFileId: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('media.stored_files as f')
    .set({ state: 'scanning', state_reason_code: null, scan_claimed_at: null, state_changed_at: now })
    .where('f.id', '=', storedFileId)
    .where('f.state', '=', 'quarantined')
    .where('f.purged_at', 'is', null)
    .where('f.erased_at', 'is', null)
    .where(sql<boolean>`${now}::timestamptz < media.quarantine_expires_at(f.quarantined_at, ${QUARANTINE_RETENTION_DAYS}::integer)`)
    .returning('f.id')
    .executeTakeFirst();
  return result !== undefined;
}

export interface DueFile {
  readonly id: string;
  readonly objectKey: string;
  readonly state: FileState;
  readonly mediaAssetId: string | null;
  readonly documentVersionId: string | null;
}

/**
 * The files whose retention has run out (EVM-049 AC5, SR-DATA-07): quarantined (or held in a new scan) and not purged, with the deadline of
 * the database function not after `now`. Row-locked `SKIP LOCKED` in the transaction of the caller: two sweepers never take the same file.
 */
export async function lockDueForPurge(db: MediaDb, now: Date, limit: number): Promise<DueFile[]> {
  const rows = await db
    .selectFrom('media.stored_files as f')
    .where('f.quarantined_at', 'is not', null)
    .where('f.purged_at', 'is', null)
    .where('f.erased_at', 'is', null)
    .where('f.state', 'in', ['quarantined', 'scanning'])
    .where(sql<boolean>`media.quarantine_expires_at(f.quarantined_at, ${QUARANTINE_RETENTION_DAYS}::integer) <= ${now}::timestamptz`)
    .orderBy('f.quarantined_at', 'asc')
    .limit(limit)
    .select(['f.id', 'f.object_key', 'f.state', 'f.media_asset_id', 'f.document_version_id'])
    .forUpdate()
    .skipLocked()
    .execute();
  return rows.map((row) => ({
    id: row.id,
    objectKey: row.object_key,
    state: row.state,
    mediaAssetId: row.media_asset_id,
    documentVersionId: row.document_version_id,
  }));
}

/** Marks the object of a quarantined file as removed. @returns whether the mark was set now (`false`: someone set it first - no second audit event) */
export async function markPurged(db: MediaDb, storedFileId: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('media.stored_files')
    .set({ purged_at: now })
    .where('id', '=', storedFileId)
    .where('state', '=', 'quarantined')
    .where('purged_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

export interface AbandonedFile {
  readonly id: string;
  readonly objectKey: string;
  readonly sessions: ReadonlyArray<{ readonly id: string; readonly uploadId: string }>;
}

/**
 * Unfinished uploads nobody continues (EVM-049 D9, RR-NOC-T1-4): `pending_upload` since before `cutoff` and WITHOUT an active, unexpired
 * session. Row-locked `SKIP LOCKED` with the lock `create-upload-session` also takes, so a session opened at this moment either wins (the file
 * is not taken) or finds the file already `failed`/`abandoned`, which it resumes like a `checksum_mismatch`. The sessions still marked
 * `active` (expired) come with the file, to be closed and aborted in the storage.
 */
export async function lockAbandoned(db: MediaDb, cutoff: Date, now: Date, limit: number): Promise<AbandonedFile[]> {
  const files = await db
    .selectFrom('media.stored_files as f')
    .where('f.state', '=', 'pending_upload')
    .where('f.state_changed_at', '<', cutoff)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('media.upload_sessions as s')
            .select('s.id')
            .whereRef('s.stored_file_id', '=', 'f.id')
            .where('s.state', '=', 'active')
            .where('s.expires_at', '>', now),
        ),
      ),
    )
    .orderBy('f.state_changed_at', 'asc')
    .limit(limit)
    .select(['f.id', 'f.object_key'])
    .forUpdate()
    .skipLocked()
    .execute();
  if (files.length === 0) return [];
  const sessions = await db
    .selectFrom('media.upload_sessions')
    .where(
      'stored_file_id',
      'in',
      files.map((file) => file.id),
    )
    .where('state', '=', 'active')
    .select(['id', 'stored_file_id', 's3_upload_id'])
    .execute();
  return files.map((file) => ({
    id: file.id,
    objectKey: file.object_key,
    sessions: sessions.filter((row) => row.stored_file_id === file.id).map((row) => ({ id: row.id, uploadId: row.s3_upload_id })),
  }));
}

/** Unfinished media of one creator (`pending_upload`): the count of the limit (EVM-049 D9). */
export async function countPendingOfCreator(db: MediaDb, userId: string): Promise<number> {
  const row = await db
    .selectFrom('media.stored_files')
    .where('state', '=', 'pending_upload')
    .where('created_by', '=', userId)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** Unfinished media of one order (`pending_upload`): the count of the limit (EVM-049 D9). */
export async function countPendingOfOrder(db: MediaDb, workOrderId: string): Promise<number> {
  const row = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.work_order_id', '=', workOrderId)
    .where('f.state', '=', 'pending_upload')
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/** Serialises the creators of media of one subject (a user or an order) in the transaction, so the count after it cannot be passed by a parallel request (CWE-367). */
export async function lockPendingCounter(db: MediaDb, kind: 'user' | 'order', subjectId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`media-pending:${kind}:${subjectId}`}, 0))`.execute(db);
}

export interface Unprocessed {
  readonly id: string;
  readonly state: 'clean' | 'processing';
  readonly attempts: number;
}

/**
 * The photos waiting for their derivatives (EVM-068): `clean`, or `processing` that nobody touched since `staleBefore` (a worker died, the processor
 * failed on a try), oldest first, of ONE kind of medium (photos and videos have separate loops, EVM-046). A file `clean` before the deployment is simply found here.
 */
export async function findUnprocessed(
  db: MediaDb,
  staleBefore: Date,
  limit: number,
  mediaType: 'photo' | 'video' = 'photo',
): Promise<Unprocessed[]> {
  const rows = await db
    .selectFrom('media.stored_files as f')
    .innerJoin('media.media_assets as a', 'a.id', 'f.media_asset_id')
    .where('a.media_type', '=', mediaType)
    .where('f.erased_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('f.state', '=', 'clean'),
        eb.and([eb('f.state', '=', 'processing'), sql<boolean>`(f.process_claimed_at is null or f.process_claimed_at < ${staleBefore})`]),
      ]),
    )
    .orderBy('f.state_changed_at', 'asc')
    .limit(limit)
    .select(['f.id', 'f.state', 'f.process_attempts'])
    .execute();
  return rows.map((row) => ({ id: row.id, state: row.state as 'clean' | 'processing', attempts: row.process_attempts }));
}

/** Photos that still wait for derivatives after `olderThan` - the count for the warning of the worker (nothing stays silent). */
export async function countUnprocessedStuck(db: MediaDb, olderThan: Date, mediaType: 'photo' | 'video' = 'photo'): Promise<number> {
  const row = await db
    .selectFrom('media.stored_files as f')
    .innerJoin('media.media_assets as a', 'a.id', 'f.media_asset_id')
    .where('a.media_type', '=', mediaType)
    .where('f.state', 'in', ['clean', 'processing'])
    .where('f.state_changed_at', '<', olderThan)
    .select(sql<string>`count(*)`.as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * Takes a file for processing: `clean` at once, `processing` only when nobody has touched it since `staleBefore`. The take RAISES the counter
 * (a crash of the processor then uses an attempt too — no poison pill) and only while fewer than `maxAttempts` takes were made. One worker wins
 * (compare-and-set, ADR-0010); the others get `undefined`.
 */
export async function claimForProcessing(
  db: MediaDb,
  storedFileId: string,
  staleBefore: Date,
  now: Date,
  maxAttempts: number,
): Promise<StoredFileRow | undefined> {
  return db
    .updateTable('media.stored_files')
    .set({
      state: 'processing',
      process_claimed_at: now,
      process_attempts: sql<number>`process_attempts + 1`,
      state_changed_at: sql<Date>`case when state = 'clean' then ${now}::timestamptz else state_changed_at end`,
    })
    .where('id', '=', storedFileId)
    .where('erased_at', 'is', null)
    .where('process_attempts', '<', maxAttempts)
    .where((eb) =>
      eb.or([
        eb('state', '=', 'clean'),
        eb.and([eb('state', '=', 'processing'), sql<boolean>`(process_claimed_at is null or process_claimed_at < ${staleBefore})`]),
      ]),
    )
    .returningAll()
    .executeTakeFirst();
}

/** Gives back the attempt of a take that never reached the processor (the claim time stays: the file is retried after the stale period). */
export async function releaseProcessingAttempt(db: MediaDb, storedFileId: string): Promise<void> {
  await db
    .updateTable('media.stored_files')
    .set({ process_attempts: sql<number>`greatest(process_attempts - 1, 0)` })
    .where('id', '=', storedFileId)
    .where('state', '=', 'processing')
    .execute();
}

export interface NewDerivative {
  readonly storedFileId: string;
  readonly variant: DerivativeVariant;
  readonly objectKey: string;
  readonly contentType?: 'image/webp' | 'video/mp4';
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
}

/** Writes the rows of the derivatives of a file (once; the table has no UPDATE and no DELETE for the application role). */
export async function insertDerivatives(db: MediaDb, derivatives: readonly NewDerivative[], now: Date): Promise<void> {
  await db
    .insertInto('media.file_derivatives')
    .values(
      derivatives.map((item) => ({
        stored_file_id: item.storedFileId,
        variant: item.variant,
        object_key: item.objectKey,
        content_type: item.contentType ?? ('image/webp' as const),
        width: item.width,
        height: item.height,
        size_bytes: item.sizeBytes,
        created_at: now,
      })),
    )
    .execute();
}

export interface DerivativeSource {
  readonly objectKey: string;
  /** The type recorded with the row of the derivative (set by the server when it was written): the `Content-Type` of the signed address. */
  readonly contentType: 'image/webp' | 'video/mp4';
}

/**
 * The derivative a caller may be given an address for, in ONE statement (EVM-068 AC6, AC7; CWE-639): the medium of THIS order, its file
 * only when it is `ready`, and the row of the variant. A medium of another order, a missing one, a file in any other state and a missing row
 * are the same absence. The order itself was resolved through the read policy by the caller.
 */
export async function findReadyDerivative(
  db: MediaDb,
  workOrderId: string,
  mediaAssetId: string,
  variant: DerivativeVariant,
): Promise<DerivativeSource | undefined> {
  const row = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .innerJoin('media.file_derivatives as d', (join) => join.onRef('d.stored_file_id', '=', 'f.id').on('d.variant', '=', variant))
    .where('a.id', '=', mediaAssetId)
    .where('a.work_order_id', '=', workOrderId)
    .where('a.deleted_at', 'is', null)
    .where('f.erased_at', 'is', null)
    .where('f.state', '=', 'ready')
    .select(['d.object_key', 'd.content_type'])
    .executeTakeFirst();
  return row === undefined ? undefined : { objectKey: row.object_key, contentType: row.content_type };
}

export interface OriginalSource {
  readonly objectKey: string;
  /** The version the scan passed (`null` for an object written before versions were recorded): the signed address pins it (TOCTOU). */
  readonly versionId: string | null;
  readonly contentType: string | null;
  readonly originalFilename: string | null;
  readonly state: FileState;
  readonly reason: ReasonCode | null;
  readonly mediaType: 'photo' | 'video';
  readonly durationSeconds: number | null;
  readonly avScanned: boolean | null;
}

/**
 * The original a caller may be given an address for, in ONE statement scoped to the order (EVM-045 AC6; CWE-639): the medium of THIS order
 * with its file. Whether the state allows the download is decided by the caller ({@link isOriginalDownloadable}); a medium of another order and a
 * missing one are the same absence.
 */
export async function findOriginal(db: MediaDb, workOrderId: string, mediaAssetId: string): Promise<OriginalSource | undefined> {
  const row = await db
    .selectFrom('media.media_assets as a')
    .innerJoin('media.stored_files as f', 'f.media_asset_id', 'a.id')
    .where('a.id', '=', mediaAssetId)
    .where('a.work_order_id', '=', workOrderId)
    .where('a.deleted_at', 'is', null)
    .where('f.erased_at', 'is', null)
    .where('f.purpose', '=', 'media_original')
    .select([
      'f.object_key',
      'f.s3_version_id',
      'f.content_type',
      'f.original_filename',
      'f.state',
      'f.state_reason_code',
      'f.duration_seconds',
      'f.av_scanned',
      'a.media_type',
    ])
    .executeTakeFirst();
  return row === undefined
    ? undefined
    : {
        objectKey: row.object_key,
        versionId: row.s3_version_id,
        contentType: row.content_type,
        originalFilename: row.original_filename,
        state: row.state,
        reason: row.state_reason_code,
        mediaType: row.media_type,
        durationSeconds: row.duration_seconds,
        avScanned: row.av_scanned,
      };
}

/**
 * Records the result of the structural check of a video (ffprobe): the duration, in its OWN short transaction BEFORE the transcoding starts, so that a
 * timeout of the transcoding does not lose it. Compare-and-set on `processing`; the column is written once (a repeat of the probe keeps the first value).
 * @returns whether the file was in `processing`
 */
export async function recordDuration(db: MediaDb, storedFileId: string, durationSeconds: number): Promise<boolean> {
  const result = await db
    .updateTable('media.stored_files')
    .set({ duration_seconds: sql<number>`coalesce(duration_seconds, ${durationSeconds}::integer)` })
    .where('id', '=', storedFileId)
    .where('state', '=', 'processing')
    .returning('id')
    .executeTakeFirst();
  return result !== undefined;
}

/** One key for the claim of a film: the claims of films are serialised by it (ONE film is transcoded at a time, whatever the number of workers). */
const VIDEO_CLAIM_LOCK = 'media-video-claim';

/**
 * The take of a FILM by the processing loop (EVM-046 AC5: the concurrency is ONE and it holds in the database, not only in the process): like
 * {@link claimForProcessing}, and in addition no other film may be `processing` with a fresh claim. The check and the update must not race, so the
 * claims of films are serialised by a transaction-scoped advisory lock taken FIRST - the second claim waits, then its statement sees the committed
 * `processing` row of the first and takes nothing. MUST run inside a transaction (the lock lives as long as it). Photos do not take this path.
 */
export async function claimVideoForProcessing(
  db: MediaDb,
  storedFileId: string,
  staleBefore: Date,
  now: Date,
  maxAttempts: number,
): Promise<StoredFileRow | undefined> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${VIDEO_CLAIM_LOCK}, 0))`.execute(db);
  return db
    .updateTable('media.stored_files')
    .set({
      state: 'processing',
      process_claimed_at: now,
      process_attempts: sql<number>`process_attempts + 1`,
      state_changed_at: sql<Date>`case when state = 'clean' then ${now}::timestamptz else state_changed_at end`,
    })
    .where('id', '=', storedFileId)
    .where('erased_at', 'is', null)
    .where('process_attempts', '<', maxAttempts)
    .where((eb) =>
      eb.or([
        eb('state', '=', 'clean'),
        eb.and([eb('state', '=', 'processing'), sql<boolean>`(process_claimed_at is null or process_claimed_at < ${staleBefore})`]),
      ]),
    )
    .where(
      sql<boolean>`not exists (
        select 1 from media.stored_files other join media.media_assets a on a.id = other.media_asset_id
        where a.media_type = 'video' and other.state = 'processing' and other.id <> media.stored_files.id and other.process_claimed_at >= ${staleBefore}
      )`,
    )
    .returningAll()
    .executeTakeFirst();
}

/** The recorded size of a file (the room the film needs is decided from it BEFORE the film is taken); `undefined` for a missing file or one the scan has not measured. */
export async function recordedSize(db: MediaDb, storedFileId: string): Promise<number | undefined> {
  const row = await db.selectFrom('media.stored_files').where('id', '=', storedFileId).select('size_bytes').executeTakeFirst();
  return row?.size_bytes == null ? undefined : Number(row.size_bytes);
}

/** The medium of THIS order, row-locked: another order's medium, a document with that id and a missing one are the same absence (SR-AUTHZ-02). */
export async function lockAssetOfOrder(db: MediaDb, workOrderId: string, mediaAssetId: string): Promise<MediaAssetRow | undefined> {
  return db
    .selectFrom('media.media_assets')
    .where('id', '=', mediaAssetId)
    .where('work_order_id', '=', workOrderId)
    .where('deleted_at', 'is', null)
    .selectAll()
    .forNoKeyUpdate()
    .executeTakeFirst();
}

/** What a change of a medium sets; a field that is absent stays as it is (`null` clears the description and the stage). */
export interface AssetChange {
  readonly category?: string;
  readonly description?: string | null;
  readonly procedureStageId?: string | null;
}

/** Applies a change under the lock of the caller; the version moves by one. @returns the new version, or `undefined` when the version differs */
export async function updateAssetMetadata(
  db: MediaDb,
  mediaAssetId: string,
  expectedVersion: number,
  change: AssetChange,
  userId: string,
  now: Date,
): Promise<number | undefined> {
  const row = await db
    .updateTable('media.media_assets')
    .set({
      ...(change.category === undefined ? {} : { category: change.category }),
      ...(change.description === undefined ? {} : { description: change.description }),
      ...(change.procedureStageId === undefined ? {} : { procedure_stage_id: change.procedureStageId }),
      updated_at: now,
      updated_by: userId,
      version: sql<number>`version + 1`,
    })
    .where('id', '=', mediaAssetId)
    .where('version', '=', expectedVersion)
    .returning('version')
    .executeTakeFirst();
  return row?.version;
}
