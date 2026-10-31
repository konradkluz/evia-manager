import {
  completeUploadSession,
  createMediaAssets,
  createUploadSession,
  getUploadPartUrl,
  listUploadParts,
  type Client,
  type MediaAsset,
  type MediaCategory,
} from '@evia/contracts';
import { ApiError, unwrap } from '../api/client.ts';
import { uuidv7 } from '../customers/uuid.ts';
import { MAX_BATCH } from './media-files.ts';

/**
 * The upload of photos from the browser (EVM-044 AC1, AC4, AC5, AC8; flows/06 → W-09): the engine behind the queue. It lives in the
 * memory of the tab only (SR-WEB-05: no localStorage, IndexedDB or Cache API for files, names or addresses) — what a closed tab
 * loses is found again on the server as an unfinished session of the person (`uploadState=unfinished`).
 *
 * One file at a time (a phone on a mobile network): the SHA-256 in a worker, the media of the batch in ONE request (the same
 * `Idempotency-Key` on a retry), then per file the session, the parts that the server does not have yet (`ListParts` — the way
 * back after a locked screen), the signed `PUT`s straight to the bucket (`credentials: 'omit'`, no CSRF, no cookies), `complete`
 * and the verdict of the scan that the screen reads from the list.
 */
export type ItemStatus = 'hashing' | 'queued' | 'uploading' | 'paused' | 'checking' | 'done' | 'failed' | 'attention';
export type FailureKind = 'checksum' | 'different' | 'network' | 'rate' | 'storage' | 'incomplete' | 'server';

export interface QueueItem {
  /** The id of the media (UUIDv7 made here). */
  readonly key: string;
  readonly name: string;
  readonly size: number;
  readonly status: ItemStatus;
  /** A film is told apart in the texts ("Wysłano film — możesz go usunąć z telefonu."). */
  readonly kind: 'photo' | 'video';
  /** 0 … 100 of the bytes of the confirmed parts and of the part in flight. */
  readonly percent: number;
  readonly failure: FailureKind | null;
  readonly retryAfterSeconds: number | null;
  /** `paused` by the person ("Wstrzymaj") — otherwise `paused` is the wait for the connection. */
  readonly byPerson: boolean;
}

export interface UnfinishedSession {
  readonly mediaAssetId: string;
  readonly name: string;
  readonly size: number;
  /** `null` when the session is gone (expired, aborted, never made): the chosen file then opens a new one for the SAME medium. */
  readonly session: { readonly id: string; readonly partSize: number; readonly partCount: number } | null;
}

export interface PutResult {
  readonly ok: boolean;
  readonly status: number;
}

export interface EngineDeps {
  readonly client: Client;
  readonly workOrderId: string;
  hash: (file: Blob) => Promise<string>;
  /** `PUT` of one part to the signed address; throws when there is no answer (network). */
  put: (url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void) => Promise<PutResult>;
  isOnline: () => boolean;
  whenOnline: () => Promise<void>;
  newId?: () => string;
}

export interface AddOptions {
  readonly category: MediaCategory;
  readonly description: string;
  readonly contentTypes: ReadonlyMap<File, string>;
  /** Unfinished sessions of the person: a chosen file that fits one resumes it instead of creating a new medium. */
  readonly unfinished?: readonly UnfinishedSession[];
}

interface Internal {
  item: QueueItem;
  file: File;
  sha256: string;
  contentType: string;
  category: MediaCategory;
  description: string;
  session: { id: string; partSize: number; partCount: number } | null;
  sessionKey: string | null;
  created: boolean;
  /** The file resumes a medium that was made earlier (a closed tab): the server has its checksum, this tab does not. */
  resumed: boolean;
  batch: string | null;
  controller: AbortController | null;
}

interface Batch {
  readonly key: string;
  readonly ids: string[];
}

const SERVER_TO_STATUS: Readonly<Record<string, ItemStatus>> = {
  pending_upload: 'checking',
  uploaded: 'checking',
  scanning: 'checking',
  clean: 'done',
  processing: 'done',
  ready: 'done',
  quarantined: 'attention',
};

/** Matches a chosen file to an unfinished session: the same name and size (the list does not carry the checksum, SR-CRYPTO-05). */
export function findUnfinished(
  file: { readonly name: string; readonly size: number },
  sessions: readonly UnfinishedSession[],
  taken: ReadonlySet<string>,
) {
  return sessions.find((entry) => !taken.has(entry.mediaAssetId) && entry.name === file.name && entry.size === file.size);
}

export class UploadEngine {
  private readonly items = new Map<string, Internal>();
  private readonly batches = new Map<string, Batch>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly QueueItem[] = [];
  private draining = false;
  private waitingOnline = false;

  private readonly deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly QueueItem[] => this.snapshot;

  /** Something the person would lose by closing the tab: files not on the server yet, or failed ones that are only in memory. */
  hasUnsent(): boolean {
    return this.snapshot.some((entry) => ['hashing', 'queued', 'uploading', 'paused', 'failed'].includes(entry.status));
  }

  private id(): string {
    return (this.deps.newId ?? uuidv7)();
  }

  private patch(key: string, change: Partial<QueueItem>): void {
    const entry = this.items.get(key);
    if (entry === undefined) return;
    // A change that changes nothing is not announced: the screen reads the verdicts again after every change of the queue.
    if ((Object.keys(change) as (keyof QueueItem)[]).every((field) => entry.item[field] === change[field])) return;
    entry.item = { ...entry.item, ...change };
    this.refresh();
  }

  private refresh(): void {
    this.snapshot = [...this.items.values()].map((value) => value.item);
    for (const listener of this.listeners) listener();
  }

  /** Puts the chosen files in the queue: hash, create the media of the batch (or resume the unfinished ones), then upload. */
  async add(files: readonly File[], options: AddOptions): Promise<void> {
    const taken = new Set<string>();
    const fresh: Internal[] = [];
    const created: Internal[] = [];
    for (const file of files.slice(0, MAX_BATCH)) {
      const match = findUnfinished(file, options.unfinished ?? [], taken);
      if (match !== undefined) taken.add(match.mediaAssetId);
      const key = match?.mediaAssetId ?? this.id();
      const entry: Internal = {
        item: {
          key,
          name: file.name,
          size: file.size,
          kind: (options.contentTypes.get(file) ?? file.type).startsWith('video/') ? 'video' : 'photo',
          status: 'hashing',
          percent: 0,
          failure: null,
          retryAfterSeconds: null,
          byPerson: false,
        },
        file,
        sha256: '',
        contentType: options.contentTypes.get(file) ?? file.type,
        category: options.category,
        description: options.description,
        session: match?.session == null ? null : { ...match.session },
        sessionKey: null,
        created: match !== undefined,
        resumed: match !== undefined,
        batch: null,
        controller: null,
      };
      this.items.set(key, entry);
      (match === undefined ? fresh : created).push(entry);
    }
    this.refresh();
    for (const entry of created) this.patch(entry.item.key, { status: 'queued' });
    await this.prepare(fresh);
    void this.drain();
  }

  /** The hash of every NEW file goes into the request that creates the media; a resumed file needs none (the server has it). */
  private async prepare(entries: readonly Internal[]): Promise<void> {
    for (const entry of entries) {
      this.patch(entry.item.key, { status: 'hashing', failure: null, retryAfterSeconds: null });
      try {
        entry.sha256 = await this.deps.hash(entry.file);
      } catch {
        this.patch(entry.item.key, { status: 'failed', failure: 'server' });
      }
    }
    const ready = entries.filter((entry) => entry.sha256 !== '');
    if (ready.length === 0) return;
    const batch: Batch = { key: this.id(), ids: ready.map((entry) => entry.item.key) };
    for (const entry of ready) entry.batch = batch.key;
    this.batches.set(batch.key, batch);
    await this.createBatch(batch);
  }

  private async createBatch(batch: Batch): Promise<void> {
    const entries = batch.ids.map((id) => this.items.get(id)).filter((entry): entry is Internal => entry !== undefined);
    for (const entry of entries) this.patch(entry.item.key, { status: 'hashing', failure: null, retryAfterSeconds: null });
    try {
      await unwrap(
        createMediaAssets({
          client: this.deps.client,
          path: { workOrderId: this.deps.workOrderId },
          headers: { 'Idempotency-Key': batch.key },
          body: {
            items: entries.map((entry) => ({
              id: entry.item.key,
              category: entry.category,
              ...(entry.description.trim() === '' ? {} : { description: entry.description.trim() }),
              fileName: entry.file.name,
              declaredSize: entry.file.size,
              contentType: entry.contentType,
              sha256: entry.sha256,
            })),
          },
        }),
      );
      for (const entry of entries) {
        entry.created = true;
        this.patch(entry.item.key, { status: 'queued' });
      }
    } catch (error) {
      const failure = this.describe(error);
      for (const entry of entries) this.patch(entry.item.key, { status: 'failed', ...failure });
    }
  }

  private describe(error: unknown): { failure: FailureKind; retryAfterSeconds: number | null } {
    if (error instanceof ApiError) {
      if (error.status === 429) return { failure: 'rate', retryAfterSeconds: error.retryAfterSeconds ?? null };
      if (error.status === 503 && error.code === 'media_storage_unavailable') return { failure: 'storage', retryAfterSeconds: null };
      if (error.status === 422 && error.code === 'upload_incomplete') return { failure: 'incomplete', retryAfterSeconds: null };
      if (error.status === 0 || error.status >= 500) return { failure: 'network', retryAfterSeconds: null };
      return { failure: 'server', retryAfterSeconds: null };
    }
    return { failure: 'network', retryAfterSeconds: null };
  }

  /** "Wstrzymaj": stops the part in flight; the parts that the server confirmed stay (the session is NOT aborted). */
  pause(key: string): void {
    const entry = this.items.get(key);
    if (entry === undefined || !['queued', 'uploading'].includes(entry.item.status)) return;
    this.patch(key, { status: 'paused', byPerson: true });
    entry.controller?.abort();
  }

  /** "Wznów" after a pause by the person. */
  resume(key: string): void {
    const entry = this.items.get(key);
    if (entry?.item.status !== 'paused') return;
    this.patch(key, { status: 'queued', byPerson: false });
    void this.drain();
  }

  /** "Ponów": a file that failed goes through the steps it did not finish; after `checksum_mismatch` it gets a NEW session (EVM-044 AC5). */
  retry(key: string): void {
    const entry = this.items.get(key);
    if (entry?.item.status !== 'failed') return;
    if (entry.sha256 === '' && !entry.created) {
      // The hash never succeeded, so the medium does not exist yet: hash, then create the batch.
      void this.prepare([entry]).then(() => this.drain());
      return;
    }
    if (!entry.created && entry.batch !== null) {
      const batch = this.batches.get(entry.batch);
      if (batch !== undefined) {
        void this.createBatch(batch).then(() => this.drain());
        return;
      }
    }
    if (entry.item.failure === 'checksum' || entry.item.failure === 'different') {
      entry.session = null;
      entry.sessionKey = null;
      if (entry.sha256 === '') {
        // A resumed file: the medium exists (never created again — 409), the checksum is computed here from the bytes in hand.
        this.patch(key, { status: 'hashing', failure: null, retryAfterSeconds: null, percent: 0 });
        void this.deps
          .hash(entry.file)
          .then((hex) => {
            entry.sha256 = hex;
            this.patch(key, { status: 'queued' });
          })
          .catch(() => {
            this.patch(key, { status: 'failed', failure: 'server' });
          })
          .then(() => this.drain());
        return;
      }
    }
    this.patch(key, { status: 'queued', failure: null, retryAfterSeconds: null, percent: 0 });
    void this.drain();
  }

  /** The verdicts of the server for the files this tab has sent (the list of the media): "Sprawdzanie pliku" → "Wysłano" / "Wymaga uwagi" / failed. */
  applyServerStates(assets: readonly MediaAsset[]): void {
    for (const asset of assets) {
      const entry = this.items.get(asset.id);
      if (entry === undefined || !['checking', 'done', 'attention'].includes(entry.item.status)) continue;
      this.applyAsset(asset);
    }
  }

  private applyAsset(asset: MediaAsset): void {
    if (asset.fileState === 'failed' && asset.stateReasonCode === 'checksum_mismatch') {
      // A file chosen again for an earlier medium that differs from the one sent before is not a "damaged transmission".
      this.patch(asset.id, {
        status: 'failed',
        failure: this.items.get(asset.id)?.resumed === true ? 'different' : 'checksum',
        percent: 0,
      });
      return;
    }
    // `failed` without a reason (a derivative could not be made after `clean`): the file arrived.
    const status = asset.fileState === 'failed' ? 'done' : (SERVER_TO_STATUS[asset.fileState] ?? 'checking');
    this.patch(asset.id, { status, percent: 100, failure: null });
  }

  private next(): Internal | undefined {
    return [...this.items.values()].find((entry) => entry.item.status === 'queued' && entry.created);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let entry = this.next(); entry !== undefined; entry = this.next()) await this.upload(entry);
    } finally {
      this.draining = false;
    }
  }

  private async upload(entry: Internal): Promise<void> {
    const key = entry.item.key;
    const controller = new AbortController();
    entry.controller = controller;
    this.patch(key, { status: 'uploading', failure: null, retryAfterSeconds: null });
    try {
      const session = entry.session ?? (await this.openSession(entry));
      const listed = await unwrap(listUploadParts({ client: this.deps.client, path: this.path(key, session.id) }));
      const have = new Map(listed.items.map((part) => [part.partNumber, part.size]));
      let confirmed = listed.items.reduce((sum, part) => sum + part.size, 0);
      this.patch(key, { percent: this.percentOf(entry, confirmed) });
      for (let part = 1; part <= session.partCount; part += 1) {
        if (controller.signal.aborted) return;
        if (have.has(part)) continue;
        const size = await this.sendPart(entry, session, part, controller.signal, (loaded) => {
          this.patch(key, { percent: this.percentOf(entry, confirmed + loaded) });
        });
        have.set(part, size);
        confirmed += size;
        this.patch(key, { percent: this.percentOf(entry, confirmed) });
      }
      if (controller.signal.aborted) return;
      const asset = await unwrap(completeUploadSession({ client: this.deps.client, path: this.path(key, session.id) }));
      this.applyAsset(asset);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!this.deps.isOnline()) {
        this.patch(key, { status: 'paused', byPerson: false });
        void this.resumeWhenOnline();
        return;
      }
      this.patch(key, { status: 'failed', ...this.describe(error) });
    } finally {
      entry.controller = null;
    }
  }

  /** The bar stops at 99% until `complete` has been answered. */
  private percentOf(entry: Internal, bytes: number): number {
    return Math.min(99, Math.floor((bytes / entry.file.size) * 100));
  }

  private path(key: string, sessionId: string) {
    return { workOrderId: this.deps.workOrderId, mediaAssetId: key, sessionId };
  }

  private async openSession(entry: Internal): Promise<{ id: string; partSize: number; partCount: number }> {
    entry.sessionKey ??= this.id();
    const id = this.id();
    const session = await unwrap(
      createUploadSession({
        client: this.deps.client,
        path: { workOrderId: this.deps.workOrderId, mediaAssetId: entry.item.key },
        headers: { 'Idempotency-Key': entry.sessionKey },
        body: { id },
      }),
    );
    entry.session = { id: session.id, partSize: session.partSize, partCount: session.partCount };
    return entry.session;
  }

  private async sendPart(
    entry: Internal,
    session: { id: string; partSize: number },
    part: number,
    signal: AbortSignal,
    onProgress: (loaded: number) => void,
  ): Promise<number> {
    const body = entry.file.slice((part - 1) * session.partSize, part * session.partSize);
    // An address is fetched fresh for every try: it lives in memory only, is never logged and is dropped after the `PUT`.
    for (let attempt = 0; ; attempt += 1) {
      const { url } = await unwrap(
        getUploadPartUrl({ client: this.deps.client, path: { ...this.path(entry.item.key, session.id), partNumber: part } }),
      );
      const result = await this.deps.put(url, body, signal, onProgress);
      if (result.ok) return body.size;
      // An expired or refused address: one more try with a new one; then the file fails and "Ponów" starts from ListParts.
      if (attempt >= 1) throw new ApiError(result.status, undefined);
    }
  }

  private async resumeWhenOnline(): Promise<void> {
    if (this.waitingOnline) return;
    this.waitingOnline = true;
    try {
      await this.deps.whenOnline();
    } finally {
      this.waitingOnline = false;
    }
    for (const entry of this.items.values()) {
      if (entry.item.status === 'paused' && !entry.item.byPerson) this.patch(entry.item.key, { status: 'queued' });
    }
    void this.drain();
  }
}
