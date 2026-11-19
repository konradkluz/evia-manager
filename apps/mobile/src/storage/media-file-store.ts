import { MEDIA_CATEGORIES, type MediaCategory } from '../upload/create-media-asset';
import type { DbAccess, Tx } from './database';

/**
 * The files of the queue (EVM-130 AC4, architect 6): one row per photo or video created on the phone — the minimal table beside the
 * queue (SQLCipher, queue side of the schema), extended later by EVM-108 and not paralleled by another structure. A row carries
 * identifiers, the name of the file in the private directory of the native module (a UUID, relative), size, digest and type — never an
 * address, a token, a description or a path. The progress of an upload is NOT here (it comes from the native status and its events);
 * the state of `needs_attention` is, because the native side does not keep it.
 *
 * States: `pending` — the command `CreateMediaAsset` waits in the queue; `applied` — the server applied it (the same transaction that
 * settles the mutation sets it, so it survives any kill) and the file is to be uploaded; `uploaded` — the module sent it, the server
 * has not confirmed `clean` yet (the original stays); `needs_attention` — a decision of the user ("Wymaga uwagi"); `failed` — "Ponów";
 * `clean` — the server confirmed the file and the original was removed; the row is removed right after (EVM-111 AC5), so this state is only
 * a leftover of a removal that failed (or of a version before EVM-111) and the next run of the queue removes the row.
 */
export const MEDIA_FILE_STATES = ['pending', 'applied', 'uploaded', 'needs_attention', 'failed', 'clean'] as const;
export type MediaFileState = (typeof MEDIA_FILE_STATES)[number];

export interface MediaFileRecord {
  /** UUIDv7, also the name of the original in the private directory of the native module. */
  readonly assetId: string;
  readonly mutationId: string;
  readonly workOrderId: string;
  readonly ownerUserId: string;
  /** The UUID name of the file relative to the directory of the native module (no path). */
  readonly fileName: string;
  readonly sizeBytes: number;
  /** Lower-case hex SHA-256. */
  readonly sha256: string;
  readonly mime: string;
  readonly state: MediaFileState;
  /** A code only (`quarantined`, `id_conflict`, `checksum_mismatch`, …); never a message. */
  readonly lastCode: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * The category the technician chose (v3, EVM-108). Absent for a row from before the category existed and for a file of the e2e hook;
   * `unknown` for a code the app does not know (a row from a newer version, SR-MOB-10) — never shown as free text.
   */
  readonly category?: MediaCategory | 'unknown';
  /** The length of a film in milliseconds (v4, EVM-110); absent for a picture and for rows from before v4. It stays on the phone: the command does not carry it. */
  readonly durationMs?: number;
}

export type NewMediaFile = Omit<MediaFileRecord, 'state' | 'lastCode' | 'updatedAt' | 'category'> & { readonly category?: MediaCategory };

const DURATION_MAX_MS = 24 * 60 * 60 * 1000;

/** The files of the signed-in owner; reachable through `UnlockedStore.media` only (owner guard, SR-MOB-13). */
export interface MediaFileStore {
  /** Inserts a row in `pending` (idempotent per `assetId`: a second call changes nothing). */
  register(file: NewMediaFile): Promise<void>;
  /** Every file of the owner, oldest first. */
  list(): Promise<readonly MediaFileRecord[]>;
  setState(assetId: string, state: MediaFileState, code: string | null, at: number): Promise<void>;
  /** The row of a file that was never created in the queue (a failed enqueue) — never after `applied`. */
  remove(assetId: string): Promise<void>;
  /** "Usuń z telefonu" (EVM-108 AC6): the row of a file in `needs_attention` — only after the native file is gone (the caller removes it first). */
  discard(assetId: string): Promise<void>;
  /**
   * EVM-111 AC5: the entry of a file the server confirmed (the replica said `clean`, `processing` or `ready`) whose original is already gone: the
   * row of a file that is still `applied` / `uploaded` (the confirmation came first) or `clean` (a removal that failed earlier). NEVER a row in any other
   * state - a file that waits, is sent, failed or needs attention keeps its row whatever its age. Only the local row: no mutation of the queue.
   * `only: 'clean'` (the sweep of leftovers) narrows it to a `clean` row. Returns the number of rows removed (0 = nothing was there to remove).
   */
  discardConfirmed(assetId: string, only?: 'clean'): Promise<number>;
}

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const isMediaCategory = (value: unknown): value is MediaCategory => (MEDIA_CATEGORIES as readonly unknown[]).includes(value);

const isState = (value: unknown): value is MediaFileState => (MEDIA_FILE_STATES as readonly unknown[]).includes(value);

export async function createMediaFilesV2(tx: Tx): Promise<void> {
  await tx.exec(`
    CREATE TABLE media_files (
      asset_id TEXT PRIMARY KEY,
      mutation_id TEXT NOT NULL UNIQUE,
      work_order_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      mime TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'applied', 'uploaded', 'needs_attention', 'failed', 'clean')),
      last_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX media_files_state ON media_files (owner_user_id, state);
  `);
}

/** v3 (EVM-108): the category of a picture. Additive and nullable (rows from v2 and files of the e2e hook have none); never in the native job file (RR-98). */
export async function addMediaCategoryV3(tx: Tx): Promise<void> {
  await tx.exec('ALTER TABLE media_files ADD COLUMN category TEXT');
}

/** v4 (EVM-110): the length of a film in milliseconds. Additive and nullable (pictures and rows from v3 have none). */
export async function addMediaDurationV4(tx: Tx): Promise<void> {
  await tx.exec('ALTER TABLE media_files ADD COLUMN duration_ms INTEGER');
}

/** The checks of a new row; one place for `register` and for the registration inside the transaction of the queue. */
export function isValidNewMediaFile(file: NewMediaFile, ownerUserId: string): boolean {
  return (
    file.ownerUserId === ownerUserId &&
    ASSET_ID.test(file.assetId) &&
    file.fileName === file.assetId &&
    UUID.test(file.workOrderId) &&
    SHA256.test(file.sha256) &&
    Number.isSafeInteger(file.sizeBytes) &&
    file.sizeBytes > 0 &&
    /^(image|video)\/[a-z0-9.+-]{1,40}$/.test(file.mime) &&
    (file.category === undefined || isMediaCategory(file.category)) &&
    (file.durationMs === undefined || (Number.isSafeInteger(file.durationMs) && file.durationMs >= 0 && file.durationMs <= DURATION_MAX_MS))
  );
}

/** The INSERT of a row in `pending`; idempotent per `assetId`. Runs inside the caller's transaction. */
export async function insertMediaFile(tx: Tx, file: NewMediaFile): Promise<void> {
  await tx.run(
    `INSERT INTO media_files (asset_id, mutation_id, work_order_id, owner_user_id, file_name, size_bytes, sha256, mime, state, last_code, created_at, updated_at, category, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?) ON CONFLICT (asset_id) DO NOTHING`,
    [
      file.assetId,
      file.mutationId,
      file.workOrderId,
      file.ownerUserId,
      file.fileName,
      file.sizeBytes,
      file.sha256,
      file.mime,
      file.createdAt,
      file.createdAt,
      file.category ?? null,
      file.durationMs ?? null,
    ],
  );
}

/** The mutation of a file was settled by the server (`applied` or `duplicate`): its file is to be uploaded. Same transaction as the settle. */
export async function markMediaApplied(tx: Tx, mutationId: string, at: number): Promise<void> {
  await tx.run("UPDATE media_files SET state = 'applied', updated_at = ? WHERE mutation_id = ? AND state = 'pending'", [at, mutationId]);
}

/** `{}` for no category, the code for a known one, `unknown` for anything else (SR-MOB-10: a stored value is checked on the way out too). */
const categoryOf = (value: unknown): { category?: MediaCategory | 'unknown' } => {
  if (value === null || value === undefined) return {};
  return { category: isMediaCategory(value) ? value : 'unknown' };
};

export class SqlMediaFileStore implements MediaFileStore {
  readonly #db: DbAccess;
  readonly #ownerUserId: string;

  constructor(db: DbAccess, ownerUserId: string) {
    this.#db = db;
    this.#ownerUserId = ownerUserId;
  }

  async register(file: NewMediaFile): Promise<void> {
    if (!isValidNewMediaFile(file, this.#ownerUserId)) throw new Error('invalid_media_file');
    await this.#db.transaction((tx) => insertMediaFile(tx, file));
  }

  async list(): Promise<readonly MediaFileRecord[]> {
    const rows = await this.#db.read((tx) =>
      tx.all(
        'SELECT asset_id, mutation_id, work_order_id, owner_user_id, file_name, size_bytes, sha256, mime, state, last_code, created_at, updated_at, category, duration_ms FROM media_files WHERE owner_user_id = ? ORDER BY created_at, asset_id',
        [this.#ownerUserId],
      ),
    );
    return rows.flatMap((row): MediaFileRecord[] => {
      const state = row['state'];
      if (!isState(state)) return [];
      return [
        {
          assetId: String(row['asset_id']),
          mutationId: String(row['mutation_id']),
          workOrderId: String(row['work_order_id']),
          ownerUserId: String(row['owner_user_id']),
          fileName: String(row['file_name']),
          sizeBytes: Number(row['size_bytes']),
          sha256: String(row['sha256']),
          mime: String(row['mime']),
          state,
          lastCode: typeof row['last_code'] === 'string' ? row['last_code'] : null,
          createdAt: Number(row['created_at']),
          updatedAt: Number(row['updated_at']),
          ...categoryOf(row['category']),
          ...(typeof row['duration_ms'] === 'number' && Number.isSafeInteger(row['duration_ms']) && row['duration_ms'] >= 0
            ? { durationMs: row['duration_ms'] }
            : {}),
        },
      ];
    });
  }

  async setState(assetId: string, state: MediaFileState, code: string | null, at: number): Promise<void> {
    if (!isState(state)) throw new Error('invalid_media_state');
    await this.#db.transaction((tx) =>
      tx.run('UPDATE media_files SET state = ?, last_code = ?, updated_at = ? WHERE asset_id = ? AND owner_user_id = ?', [
        state,
        code,
        at,
        assetId,
        this.#ownerUserId,
      ]),
    );
  }

  async discard(assetId: string): Promise<void> {
    await this.#db.transaction((tx) =>
      tx.run("DELETE FROM media_files WHERE asset_id = ? AND owner_user_id = ? AND state = 'needs_attention'", [
        assetId,
        this.#ownerUserId,
      ]),
    );
  }

  async discardConfirmed(assetId: string, only?: 'clean'): Promise<number> {
    const states = only === 'clean' ? "state = 'clean'" : "state IN ('applied', 'uploaded', 'clean')";
    return this.#db.transaction((tx) =>
      tx.run(`DELETE FROM media_files WHERE asset_id = ? AND owner_user_id = ? AND ${states}`, [assetId, this.#ownerUserId]),
    );
  }

  async remove(assetId: string): Promise<void> {
    await this.#db.transaction((tx) =>
      tx.run("DELETE FROM media_files WHERE asset_id = ? AND owner_user_id = ? AND state = 'pending'", [assetId, this.#ownerUserId]),
    );
  }
}
