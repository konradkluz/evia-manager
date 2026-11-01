import {
  completeDocumentUploadSession,
  createDocument,
  createDocumentUploadSession,
  getDocumentUploadPartUrl,
  listDocumentUploadParts,
  type Client,
  type DocumentConfidentiality,
} from '@evia/contracts';
import { ApiError, unwrap } from '../api/client.ts';
import { uuidv7 } from '../customers/uuid.ts';
import type { PutResult } from './media-upload-engine.ts';

/**
 * The upload of one document from the browser (EVM-047 AC1, AC8; flows/06 → W-09 "Dodaj dokument"): the same way as the photos - the SHA-256, the
 * document with its file (`Idempotency-Key` kept for a retry), the session, the parts the server does not have yet, the signed `PUT`s straight to
 * the bucket (no cookies, no CSRF), `complete`, then the verdict of the scan that the list shows. One document at a time. The state lives in the
 * memory of the tab only (SR-WEB-05): file names and titles are personal data, nothing goes to the storage of the browser.
 */
export type DocumentItemStatus = 'hashing' | 'creating' | 'queued' | 'uploading' | 'paused' | 'done' | 'failed';
export type DocumentFailure = 'network' | 'rate' | 'validation' | 'forbidden' | 'conflict' | 'server';

export interface DocumentItem {
  /** The id of the document (UUIDv7 made here). */
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly status: DocumentItemStatus;
  readonly percent: number;
  readonly failure: DocumentFailure | null;
}

export interface NewDocument {
  readonly file: File;
  readonly contentType: string;
  readonly kindCode: string;
  readonly title: string;
  readonly description: string;
  /** Asked for the kind "Inny dokument" only; `null` = not asked. */
  readonly containsIdentityData: boolean | null;
  readonly confidentialityOverride: Exclude<DocumentConfidentiality, 'standard'> | null;
}

export interface DocumentEngineDeps {
  readonly client: Client;
  readonly workOrderId: string;
  hash: (file: Blob) => Promise<string>;
  put: (url: string, body: Blob, signal: AbortSignal, onProgress: (loaded: number) => void) => Promise<PutResult>;
  isOnline: () => boolean;
  whenOnline: () => Promise<void>;
  newId?: () => string;
}

interface Internal {
  item: DocumentItem;
  input: NewDocument;
  sha256: string;
  createKey: string;
  sessionKey: string | null;
  created: boolean;
  session: { id: string; partSize: number; partCount: number } | null;
  controller: AbortController | null;
}

export class DocumentUploadEngine {
  private readonly items = new Map<string, Internal>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly DocumentItem[] = [];
  private draining = false;
  private waitingOnline = false;
  private readonly deps: DocumentEngineDeps;

  constructor(deps: DocumentEngineDeps) {
    this.deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly DocumentItem[] => this.snapshot;

  /** Something the person would lose by closing the tab: a file that is not on the server yet. */
  hasUnsent(): boolean {
    return this.snapshot.some((entry) => ['hashing', 'creating', 'queued', 'uploading', 'paused', 'failed'].includes(entry.status));
  }

  private id(): string {
    return (this.deps.newId ?? uuidv7)();
  }

  private patch(key: string, change: Partial<DocumentItem>): void {
    const entry = this.items.get(key);
    if (entry === undefined) return;
    if ((Object.keys(change) as (keyof DocumentItem)[]).every((field) => entry.item[field] === change[field])) return;
    entry.item = { ...entry.item, ...change };
    this.refresh();
  }

  private refresh(): void {
    this.snapshot = [...this.items.values()].map((value) => value.item);
    for (const listener of this.listeners) listener();
  }

  /** "Ukryj": a finished or failed row leaves the panel (a failed one is only in the memory of this tab). */
  dismiss(key: string): void {
    const entry = this.items.get(key);
    if (entry === undefined || ['hashing', 'creating', 'uploading'].includes(entry.item.status)) return;
    this.items.delete(key);
    this.refresh();
  }

  async add(input: NewDocument): Promise<string> {
    const key = this.id();
    this.items.set(key, {
      item: { key, name: input.file.name, title: input.title, status: 'hashing', percent: 0, failure: null },
      input,
      sha256: '',
      createKey: this.id(),
      sessionKey: null,
      created: false,
      session: null,
      controller: null,
    });
    this.refresh();
    await this.prepare(key);
    void this.drain();
    return key;
  }

  private async prepare(key: string): Promise<void> {
    const entry = this.items.get(key);
    if (entry === undefined) return;
    this.patch(key, { status: 'hashing', failure: null });
    try {
      if (entry.sha256 === '') entry.sha256 = await this.deps.hash(entry.input.file);
    } catch {
      this.patch(key, { status: 'failed', failure: 'server' });
      return;
    }
    if (entry.created) {
      this.patch(key, { status: 'queued' });
      return;
    }
    this.patch(key, { status: 'creating' });
    try {
      const { input } = entry;
      await unwrap(
        createDocument({
          client: this.deps.client,
          path: { workOrderId: this.deps.workOrderId },
          headers: { 'Idempotency-Key': entry.createKey },
          body: {
            id: key,
            kindCode: input.kindCode,
            title: input.title,
            ...(input.description === '' ? {} : { description: input.description }),
            ...(input.containsIdentityData === null ? {} : { containsIdentityData: input.containsIdentityData }),
            ...(input.confidentialityOverride === null ? {} : { confidentialityOverride: input.confidentialityOverride }),
            file: {
              fileName: input.file.name,
              contentType: input.contentType,
              declaredSize: input.file.size,
              sha256: entry.sha256,
            },
          },
        }),
      );
      entry.created = true;
      this.patch(key, { status: 'queued' });
    } catch (error) {
      this.patch(key, { status: 'failed', failure: describe(error) });
    }
  }

  /** "Ponów": goes through the steps that are not finished (the same keys, so the server does not add the document twice). */
  retry(key: string): void {
    const entry = this.items.get(key);
    if (entry?.item.status !== 'failed' || entry.item.failure === 'conflict') return;
    this.patch(key, { failure: null, percent: 0 });
    void this.prepare(key).then(() => this.drain());
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

  private path(key: string, sessionId: string) {
    return { workOrderId: this.deps.workOrderId, documentId: key, sessionId };
  }

  private async upload(entry: Internal): Promise<void> {
    const key = entry.item.key;
    const controller = new AbortController();
    entry.controller = controller;
    this.patch(key, { status: 'uploading', failure: null });
    const size = entry.input.file.size;
    const percentOf = (bytes: number) => Math.min(99, Math.floor((bytes / size) * 100));
    try {
      const session = entry.session ?? (await this.openSession(entry));
      const listed = await unwrap(listDocumentUploadParts({ client: this.deps.client, path: this.path(key, session.id) }));
      const have = new Set(listed.items.map((part) => part.partNumber));
      let confirmed = listed.items.reduce((sum, part) => sum + part.size, 0);
      this.patch(key, { percent: percentOf(confirmed) });
      for (let part = 1; part <= session.partCount; part += 1) {
        if (controller.signal.aborted) return;
        if (have.has(part)) continue;
        const sent = await this.sendPart(entry, session, part, controller.signal, (loaded) => {
          this.patch(key, { percent: percentOf(confirmed + loaded) });
        });
        confirmed += sent;
        this.patch(key, { percent: percentOf(confirmed) });
      }
      if (controller.signal.aborted) return;
      await unwrap(completeDocumentUploadSession({ client: this.deps.client, path: this.path(key, session.id) }));
      this.patch(key, { status: 'done', percent: 100 });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!this.deps.isOnline()) {
        this.patch(key, { status: 'paused' });
        void this.resumeWhenOnline();
        return;
      }
      // The session is opened again by the retry. The same `Idempotency-Key` would give the same session after a transient failure, but for an
      // aborted or expired one the server answers `409 invalid_state_transition`: then the retry needs a new key.
      entry.session = null;
      if (isEndedSession(error)) entry.sessionKey = null;
      this.patch(key, { status: 'failed', failure: describe(error) });
    } finally {
      entry.controller = null;
    }
  }

  private async openSession(entry: Internal): Promise<{ id: string; partSize: number; partCount: number }> {
    entry.sessionKey ??= this.id();
    const session = await unwrap(
      createDocumentUploadSession({
        client: this.deps.client,
        path: { workOrderId: this.deps.workOrderId, documentId: entry.item.key },
        headers: { 'Idempotency-Key': entry.sessionKey },
        body: { id: this.id() },
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
    const body = entry.input.file.slice((part - 1) * session.partSize, part * session.partSize);
    // An address is fetched fresh for every try: it lives in memory only, is never logged and is dropped after the `PUT`.
    for (let attempt = 0; ; attempt += 1) {
      const { url } = await unwrap(
        getDocumentUploadPartUrl({ client: this.deps.client, path: { ...this.path(entry.item.key, session.id), partNumber: part } }),
      );
      const result = await this.deps.put(url, body, signal, onProgress);
      if (result.ok) return body.size;
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
      if (entry.item.status === 'paused') this.patch(entry.item.key, { status: 'queued' });
    }
    void this.drain();
  }
}

/** `409 invalid_state_transition`: the session was aborted or expired on the server (not a clash of ids). */
function isEndedSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'invalid_state_transition';
}

function describe(error: unknown): DocumentFailure {
  if (!(error instanceof ApiError)) return 'network';
  if (error.status === 429) return 'rate';
  if (error.status === 403) return 'forbidden';
  if (isEndedSession(error)) return 'server';
  if (error.status === 409) return 'conflict';
  if (error.status === 400 || error.status === 422) return 'validation';
  if (error.status === 0) return 'network';
  return 'server';
}
