import type { QueueStore, ReplicaStore, SettledInfo } from '@evia/sync-core';
import { Database } from './database';
import { StorageError, toStorageError, type StorageErrorCode } from './errors';
import { InstallationProof } from './installation-proof';
import { cipherVersionSupported, generateKeyHex, keyCheckValue, keyPragma } from './key';
import type { AppFiles, CryptoSource, DeviceSecrets, InstallationIdentity, KeyVault, StorageDiagnostic } from './ports';
import { SqlQueueStore } from './queue-store';
import { SqlReplicaStore } from './replica-store';
import { SCHEMA, isNewerThan, latest, migrate, readVersions, type SchemaPlan } from './schema';
import type { SqlEngine } from './sql';

/** Files outside the database (internal documents directory, excluded from every backup by with-hardening). */
export const WIPE_MARKER_FILE = 'evia-wipe-in-progress';
export const KEY_CHECK_FILE = 'evia-database-key-check';
/** Constant content: the marker carries no data. */
const WIPE_MARKER_CONTENT = '1';

export type DataLossReason = 'key_missing' | 'key_invalid' | 'file_corrupt';

export interface LocalDataDeps {
  readonly engine: SqlEngine;
  readonly vault: KeyVault;
  readonly files: AppFiles;
  readonly crypto: CryptoSource;
  readonly secrets: DeviceSecrets;
  readonly diagnostics: (event: StorageDiagnostic) => void;
  /** The schema of this app; tests pass synthetic plans. */
  readonly schema?: SchemaPlan;
}

/** Access to the contents of the store, handed out only to the owner after a full sign-in (capability; SR-MOB-13). */
export interface UnlockedStore {
  readonly userId: string;
  readonly queue: QueueStore;
  readonly replica: ReplicaStore;
  /**
   * Installation identity of this device. The guard protects the WRITE (only the owner after a full sign-in stores the new secret of
   * step 2, EVM-100). Before the password the first step carries the pair as an opaque proof (`LocalDataHost.installationProof`):
   * protection against user B registering with A's `deviceId` lies on the server, which ignores a pair that does not belong to the
   * account (contract EVM-090 `MobileLoginRequest`).
   */
  readonly identity: {
    read(): Promise<InstallationIdentity | null>;
    write(identity: InstallationIdentity): Promise<void>;
  };
  /** Results of settled mutations for their consumer (EVM-107); taken = removed. */
  takeSettled(): Promise<{ mutationId: string; info: SettledInfo }[]>;
  /** `unsentItemCount` of the store (see `LocalDataHost.unsentItemCount`). */
  unsentItemCount(): Promise<number>;
  /**
   * Sign-out or `session_revoked` (AC7): removes the replica atomically and the refresh token; the queue, its key, "Wymaga uwagi",
   * pending objects and the installation identity stay encrypted. The store is locked afterwards.
   */
  endSession(): Promise<void>;
  /** Drops the in-memory unlock; the handles above stop working. */
  lock(): void;
}

export type OpenResult =
  | { readonly kind: 'unlocked'; readonly store: UnlockedStore; readonly initialPullRequired: boolean }
  /** Another user owns the queue: only the number of unsent items is revealed; the only way on is the wipe (AC6). */
  | { readonly kind: 'owner_mismatch'; readonly unsentItemCount: number }
  /**
   * The database cannot be opened for a certain reason (AC5). Nothing is deleted until `acknowledge` ("Rozumiem"): it removes the old
   * file, creates a new key and database (a new device: the installation identity is dropped) and asks for the first download.
   */
  | { readonly kind: 'data_lost'; readonly reason: DataLossReason; acknowledge(): Promise<OpenResult> }
  /** The file is newer than the app (downgrade): opened read-only, nothing changed (SR-MOB-09). */
  | { readonly kind: 'update_required' }
  /** Not opened for an uncertain reason (I/O, Keystore busy, interrupted creation…): nothing deleted, try again later. */
  | { readonly kind: 'unavailable'; readonly code: StorageErrorCode }
  /** An interrupted wipe could not be finished yet; it is retried on every start ("Kończymy czyszczenie…"). */
  | { readonly kind: 'wipe_incomplete' };

/**
 * Fault of the e2e hooks (EVM-093 AC6, scenario 13): the named wipe step fails once AFTER it ran, as if the process died there. Only
 * the e2e hooks set it (src/e2e-hooks/panel.tsx, bundled in the e2e variant only); no configuration of the app reaches it.
 */
export const wipeFaultForE2e: { afterStep: string | null } = { afterStep: null };

/** Read-only facts of the open database for the e2e diagnostics (EVM-093 AC1): no key, no path, no content. */
export interface StoreFacts {
  readonly open: boolean;
  readonly cipherVersion: string | null;
  readonly tempStore: number | null;
  /** The wipe marker is present (an unfinished wipe); `null` when the marker cannot be read. */
  readonly wipePending: boolean | null;
}

type Opened = { readonly ok: true; readonly db: Database } | { readonly ok: false; readonly code: StorageErrorCode | 'update_required' };

const OWNER_KEY = 'owner_user_id';

/**
 * Opening, owner guard and wipe of the encrypted local store (EVM-093 AC1, AC2, AC5–AC7; ADR-0007, SR-MOB-01/03/04/09/13).
 * - Before sign-in only `prepare` runs: it finishes an interrupted wipe and touches no database (no file is created or read).
 * - `openForUser(userId)` after a FULL sign-in: classifies the state of key, file and key check value FAIL-SAFE — only certain
 *   causes become `data_lost`; anything else is `unavailable` and deletes nothing. Creation order: key → secure store → database →
 *   key check value (KCV), so "a key without a file" is a fresh install reusing that key.
 * - The unlock lives in memory only.
 */
export class LocalDataHost {
  readonly #deps: LocalDataDeps;
  readonly #schema: SchemaPlan;
  #db: Database | null = null;
  #unlocked: string | null = null;
  readonly #wipeSteps: { name: string; run: () => Promise<void> }[] = [];
  readonly #unsentCounters: { name: string; count: () => Promise<number> }[] = [];
  /** Tail of the host queue: prepare, openForUser, "Rozumiem" and the wipe run one at a time (one key, one database). */
  #tail: Promise<unknown> = Promise.resolve();

  constructor(deps: LocalDataDeps) {
    this.#deps = deps;
    this.#schema = deps.schema ?? SCHEMA;
  }

  /** Extra wipe steps (media, thumbnails, native jobs — E11/EVM-109), run after the built-in ones in registration order. */
  registerWipeStep(name: string, run: () => Promise<void>): void {
    this.#wipeSteps.push({ name, run });
  }

  /** Extra sources of unsent items (pending files — E11), added to `unsentItemCount` without changing the port. */
  registerUnsentCounter(name: string, count: () => Promise<number>): void {
    this.#unsentCounters.push({ name, count });
  }

  /**
   * Runs the state-changing operations of the host one after another (like `Database.#serialize`): two parallel opens on a fresh
   * install would otherwise generate two keys, and an open during the wipe would create a database with a key already destroyed.
   */
  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(task);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** Before sign-in: finishes an interrupted wipe (AC6) before any data is read; `onResume` lets the UI show "Kończymy czyszczenie…". */
  prepare(onResume?: () => void): Promise<'ready' | 'wipe_incomplete'> {
    return this.#exclusive(() => this.#prepare(onResume));
  }

  async #prepare(onResume?: () => void): Promise<'ready' | 'wipe_incomplete'> {
    let marker: string | null;
    try {
      marker = await this.#deps.files.read(WIPE_MARKER_FILE);
    } catch {
      return 'wipe_incomplete';
    }
    if (marker === null) return 'ready';
    onResume?.();
    return (await this.#runWipeSteps()) === 'done' ? 'ready' : 'wipe_incomplete';
  }

  openForUser(userId: string): Promise<OpenResult> {
    if (userId === '') return Promise.reject(new StorageError('locked'));
    return this.#exclusive(() => this.#openForUser(userId));
  }

  async #openForUser(userId: string): Promise<OpenResult> {
    if ((await this.#prepare()) === 'wipe_incomplete') return { kind: 'wipe_incomplete' };
    this.#unlocked = null;
    if (this.#db === null) {
      const opened = await this.#openOrClassify(userId);
      if (opened.kind !== 'open') return opened.result;
      this.#db = opened.db;
      return this.#unlock(userId, opened.fresh);
    }
    return this.#unlock(userId, false);
  }

  async #openOrClassify(userId: string): Promise<{ kind: 'open'; db: Database; fresh: boolean } | { kind: 'result'; result: OpenResult }> {
    const { vault, engine, files } = this.#deps;
    const key = await vault.read().catch(() => ({ kind: 'unavailable' }) as const);
    if (key.kind === 'unavailable') return this.#unavailable('key_unavailable');
    let exists: boolean;
    try {
      exists = await engine.exists();
    } catch {
      return this.#unavailable('file_unavailable');
    }
    if (!exists) return this.#createFresh(key.kind === 'present' ? key.hex : null);
    if (key.kind === 'absent') return this.#lost('key_missing', userId);
    let stored: string | null | undefined;
    try {
      stored = await files.read(KEY_CHECK_FILE);
    } catch {
      stored = undefined;
    }
    const expected = await this.#keyCheck(key.hex);
    if (expected !== null && typeof stored === 'string' && stored !== expected) return this.#lost('key_invalid', userId);
    const opened = await this.#open(key.hex);
    if (opened.ok) {
      if (stored === null && expected !== null) await files.write(KEY_CHECK_FILE, expected).catch(() => undefined);
      this.#reportHardware();
      return { kind: 'open', db: opened.db, fresh: false };
    }
    if (opened.code === 'update_required') return { kind: 'result', result: { kind: 'update_required' } };
    if (opened.code === 'not_a_database' && expected !== null && stored === expected) return this.#lost('file_corrupt', userId);
    return this.#unavailable(opened.code);
  }

  #unavailable(code: StorageErrorCode): { kind: 'result'; result: OpenResult } {
    this.#deps.diagnostics({ event: 'db-open-failed', code });
    return { kind: 'result', result: { kind: 'unavailable', code } };
  }

  #lost(reason: DataLossReason, userId: string): { kind: 'result'; result: OpenResult } {
    this.#deps.diagnostics({ event: 'db-open-failed', code: reason });
    return {
      kind: 'result',
      result: { kind: 'data_lost', reason, acknowledge: () => this.#exclusive(() => this.#resetAfterLoss(userId)) },
    };
  }

  /**
   * "Rozumiem" (AC5): a new device — identity, old file, KCV and old key go, then a new key and database are created. A database opened
   * meanwhile (another open ran first in the host queue) is already the new one: it is kept, nothing is deleted again.
   */
  async #resetAfterLoss(userId: string): Promise<OpenResult> {
    const { secrets, engine, files, vault } = this.#deps;
    if (this.#db !== null) return this.#unlock(userId, false);
    try {
      await secrets.deleteIdentity();
      await engine.remove();
      await files.remove(KEY_CHECK_FILE);
      await vault.destroy();
    } catch {
      return this.#unavailable('file_unavailable').result;
    }
    const created = await this.#createFresh(null);
    if (created.kind === 'result') return created.result;
    this.#db = created.db;
    return this.#unlock(userId, true);
  }

  async #createFresh(
    reuse: string | null,
  ): Promise<{ kind: 'open'; db: Database; fresh: boolean } | { kind: 'result'; result: OpenResult }> {
    const { files, vault, crypto } = this.#deps;
    let hex = reuse;
    try {
      // an orphaned KCV of an earlier key would make the new database look like "key_invalid"
      await files.remove(KEY_CHECK_FILE);
      if (hex === null) {
        hex = generateKeyHex(crypto);
        await vault.write(hex);
      }
    } catch (error) {
      return this.#unavailable(error instanceof StorageError ? error.code : 'key_unavailable');
    }
    const opened = await this.#open(hex);
    if (!opened.ok) return this.#unavailable(opened.code === 'update_required' ? 'sql_failed' : opened.code);
    const check = await this.#keyCheck(hex);
    if (check !== null) await files.write(KEY_CHECK_FILE, check).catch(() => undefined);
    this.#reportHardware();
    return { kind: 'open', db: opened.db, fresh: true };
  }

  /**
   * The key check value, or `null` when the digest fails: an error of expo-crypto may name its input (the key; SR-LOG-08), so it is
   * dropped here, and without a KCV no certain cause exists — the classification stays fail-safe (`unavailable`, nothing deleted).
   */
  async #keyCheck(hex: string): Promise<string | null> {
    try {
      return await keyCheckValue(this.#deps.crypto, hex);
    } catch {
      return null;
    }
  }

  #reportHardware(): void {
    void this.#deps.vault
      .hardware()
      .catch(() => 'unknown' as const)
      .then((level) => {
        this.#deps.diagnostics({ event: 'keystore-hardware', level });
      });
  }

  /**
   * Opening sequence (architecture review 2, security 5/8): key → cipher check → key test → integrity → versions; writing PRAGMAs and
   * migrations only after the version check. A newer file is left read-only and closed.
   */
  async #open(hex: string, engine: SqlEngine = this.#deps.engine): Promise<Opened> {
    let connection;
    try {
      connection = await engine.open();
    } catch (error) {
      return { ok: false, code: toStorageError(error).code };
    }
    const db = new Database(connection);
    try {
      await db.read(async (tx) => {
        await tx.exec(keyPragma(hex));
        if (!cipherVersionSupported((await tx.get('PRAGMA cipher_version'))?.['cipher_version']))
          throw new StorageError('cipher_unsupported');
        const header = await tx.get('PRAGMA cipher_plaintext_header_size');
        if (header !== undefined && Number(header['cipher_plaintext_header_size']) !== 0) throw new StorageError('cipher_misconfigured');
        await tx.get('SELECT count(*) AS n FROM sqlite_master');
        if ((await tx.get('PRAGMA quick_check'))?.['quick_check'] !== 'ok') throw new StorageError('not_a_database');
        await tx.exec('PRAGMA temp_store = MEMORY');
        await tx.exec('PRAGMA busy_timeout = 5000');
        if (Number((await tx.get('PRAGMA temp_store'))?.['temp_store']) !== 2) throw new StorageError('cipher_misconfigured');
      });
      const found = await db.read(readVersions);
      if (isNewerThan(found, latest(this.#schema))) {
        await db.read((tx) => tx.exec('PRAGMA query_only = ON'));
        await db.close();
        return { ok: false, code: 'update_required' };
      }
      await db.read(async (tx) => {
        await tx.exec('PRAGMA journal_mode = WAL');
        await tx.exec('PRAGMA synchronous = FULL');
      });
      // a failing migration is never a certain cause (AC2: the queue is never lost): unavailable, nothing deleted
      const migrated = await migrate(db, this.#schema).catch((error: unknown) => {
        const code = toStorageError(error).code;
        throw new StorageError(code === 'not_a_database' ? 'sql_failed' : code);
      });
      if (migrated.kind === 'update_required') throw new StorageError('sql_failed');
      return { ok: true, db };
    } catch (error) {
      await db.close();
      return { ok: false, code: toStorageError(error).code };
    }
  }

  async #unlock(userId: string, fresh: boolean): Promise<OpenResult> {
    const db = this.#db;
    if (db === null) throw new StorageError('closed');
    const owner = await db.read(async (tx) => (await tx.get('SELECT value FROM meta WHERE key = ?', [OWNER_KEY]))?.['value']);
    if (owner === undefined) {
      await db.transaction((tx) => tx.run('INSERT INTO meta (key, value) VALUES (?, ?)', [OWNER_KEY, userId]));
    } else if (owner !== userId) {
      return { kind: 'owner_mismatch', unsentItemCount: await this.unsentItemCount() };
    }
    this.#unlocked = userId;
    return { kind: 'unlocked', store: this.#capability(userId, db), initialPullRequired: fresh };
  }

  #capability(userId: string, db: Database): UnlockedStore {
    const access = db.gated(() => this.#unlocked === userId && this.#db === db && !db.closed);
    const queue = new SqlQueueStore(access);
    const replica = new SqlReplicaStore(access);
    const allowed = async (): Promise<void> => {
      await access.read(() => Promise.resolve());
    };
    return {
      userId,
      queue,
      replica,
      identity: {
        read: async () => {
          await allowed();
          return this.#deps.secrets.readIdentity();
        },
        write: async (identity) => {
          await allowed();
          await this.#deps.secrets.writeIdentity(identity);
        },
      },
      takeSettled: () => queue.takeSettled(),
      unsentItemCount: async () => {
        await allowed();
        return this.unsentItemCount();
      },
      endSession: async () => {
        await replica.wipeReplica();
        await this.#deps.secrets.deleteRefreshToken();
        this.#unlocked = null;
      },
      lock: () => {
        if (this.#unlocked === userId) this.#unlocked = null;
      },
    };
  }

  /**
   * EVM-100 AC1: the pair `deviceId` + installation secret for the first step of the sign-in, as an opaque value (security W3). `null`
   * = a new device (no identity, or it cannot be read): the request then carries no pair — never an error. Runs in the host queue, so
   * it never sees the identity half-way through a wipe or a reset.
   */
  installationProof(): Promise<InstallationProof | null> {
    return this.#exclusive(async () => {
      try {
        const identity = await this.#deps.secrets.readIdentity();
        return identity === null ? null : InstallationProof.of(identity);
      } catch {
        return null;
      }
    });
  }

  /**
   * EVM-100 AC3 (`426`, "Zobacz kolejkę"): the number of unsent items BEFORE a sign-in, so the update screen can say that they are
   * safe. Only a number leaves (as with `owner_mismatch`); nothing is unlocked and no database is created — without a file it is the
   * count of the registered sources, and any uncertain state (no key, a wipe to finish, a file that does not open) is `null`.
   */
  unsentItemCountBeforeSignIn(): Promise<number | null> {
    return this.#exclusive(async () => {
      if ((await this.#prepare()) === 'wipe_incomplete') return null;
      try {
        if (this.#db === null && (await this.#deps.engine.exists())) {
          const opened = await this.#openOrClassify('');
          if (opened.kind !== 'open') return null;
          this.#db = opened.db;
        }
        return await this.unsentItemCount();
      } catch {
        return null;
      }
    });
  }

  /** EVM-093 AC1 (e2e diagnostics): cipher version and temp_store of the open database; nothing is opened or created here. */
  async facts(): Promise<StoreFacts> {
    const wipePending = await this.#deps.files.read(WIPE_MARKER_FILE).then(
      (marker) => marker !== null,
      () => null,
    );
    const db = this.#db;
    if (db === null || db.closed) return { open: false, cipherVersion: null, tempStore: null, wipePending };
    return db.read(async (tx) => {
      const version = (await tx.get('PRAGMA cipher_version'))?.['cipher_version'];
      const tempStore = Number((await tx.get('PRAGMA temp_store'))?.['temp_store']);
      return {
        open: true,
        cipherVersion: typeof version === 'string' ? version : null,
        tempStore: Number.isFinite(tempStore) ? tempStore : null,
        wipePending,
      };
    });
  }

  /**
   * EVM-093 AC6 (e2e proof that an old file is unrecoverable): opens ANOTHER file with the current key by the same opening sequence and
   * closes it again. Answers a code only; the database of the host is untouched.
   */
  async probe(engine: SqlEngine): Promise<'opened' | StorageErrorCode | 'update_required'> {
    const key = await this.#deps.vault.read().catch(() => ({ kind: 'unavailable' }) as const);
    if (key.kind !== 'present') return 'key_unavailable';
    const opened = await this.#open(key.hex, engine);
    if (!opened.ok) return opened.code;
    await opened.db.close();
    return 'opened';
  }

  /**
   * Unsent items = entries of the queue (pending, retrying, blocked and "Wymaga uwagi" — all of them are queue entries; objects created
   * on the phone are derived from the queue, offline-sync.md) + registered sources (pending files, E11). Only a number leaves here.
   */
  async unsentItemCount(): Promise<number> {
    const db = this.#db;
    let total = 0;
    if (db !== null && !db.closed) total += Number((await db.read((tx) => tx.get('SELECT count(*) AS n FROM queue_entries')))?.['n'] ?? 0);
    for (const counter of this.#unsentCounters) total += await counter.count();
    return total;
  }

  /**
   * "Wyczyść dane firmowe" (AC6; port for EVM-101): the marker first, then every step in a fixed order, each idempotent; a failing step
   * keeps the marker and the whole sequence is repeated on the next start. Afterwards no old file can be opened (its key is gone).
   */
  wipeCompanyData(): Promise<'done' | 'incomplete'> {
    return this.#exclusive(() => this.#wipeCompanyData());
  }

  async #wipeCompanyData(): Promise<'done' | 'incomplete'> {
    try {
      await this.#deps.files.write(WIPE_MARKER_FILE, WIPE_MARKER_CONTENT);
    } catch {
      return 'incomplete';
    }
    return this.#runWipeSteps();
  }

  /** Names of the steps in their order (documentation and tests). */
  wipeStepNames(): string[] {
    return this.#steps().map((step) => step.name);
  }

  #steps(): { name: string; run: () => Promise<void> }[] {
    const { vault, engine, files, secrets } = this.#deps;
    return [
      {
        name: 'close_database',
        run: async () => {
          this.#unlocked = null;
          const db = this.#db;
          this.#db = null;
          await db?.close();
        },
      },
      { name: 'database_key', run: () => vault.destroy() },
      { name: 'database_file', run: () => engine.remove() },
      { name: 'key_check_value', run: () => files.remove(KEY_CHECK_FILE) },
      { name: 'installation_identity', run: () => secrets.deleteIdentity() },
      { name: 'secure_store', run: () => secrets.deleteAllSecrets() },
      { name: 'preferences', run: () => secrets.deletePreferences() },
      { name: 'crash_reports', run: () => secrets.deleteCrashReports() },
      ...this.#wipeSteps,
      { name: 'wipe_marker', run: () => files.remove(WIPE_MARKER_FILE) },
    ];
  }

  async #runWipeSteps(): Promise<'done' | 'incomplete'> {
    for (const step of this.#steps()) {
      try {
        await step.run();
        if (wipeFaultForE2e.afterStep === step.name) {
          wipeFaultForE2e.afterStep = null;
          throw new StorageError('file_unavailable');
        }
      } catch {
        this.#deps.diagnostics({ event: 'wipe-step-failed', step: step.name });
        return 'incomplete';
      }
    }
    return 'done';
  }
}
