/**
 * Reference model of the file upload protocol (EVM-109; ADR-0020, media-pipeline.md). The same logic runs in Kotlin on the phone
 * (apps/mobile/modules/evia-upload/engine); both implementations read the shared vectors in `conformance/upload/` and must give
 * identical results. Pure TypeScript behind ports: no network, no files, no clock.
 */

/** Version of the persisted snapshot. An unknown version never crashes the engine: the job restarts through ListParts. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** In-process limits of one engine run (shared with Kotlin, asserted against `conformance/upload/backoff.json`). */
export const UPLOAD_LIMITS = Object.freeze({
  /** Attempts of one call (the first call included) before the run returns `retry_later`. */
  maxAttempts: 4,
  /** Renewals of the signed address of one part after `403`. */
  maxRenewals: 3,
  baseDelayMs: 1000,
  capDelayMs: 30_000,
  maxParts: 1000,
});

/** What a port reports when a call did not succeed: an HTTP answer (`code` is the problem `code`) or no answer at all. */
export type Failure = { readonly kind: 'network' } | { readonly kind: 'http'; readonly status: number; readonly code?: string };

/** Thrown by ports (API, part transport). The engine never sees other error types from them. */
export class UploadFailure extends Error {
  readonly failure: Failure;
  constructor(failure: Failure) {
    super(failure.kind === 'network' ? 'network' : `http ${failure.status}`);
    this.failure = failure;
  }
}

/** Input of `mapFailure`: a failure or the file state returned by `complete`. */
export type MappingInput = Failure | { readonly kind: 'fileState'; readonly state: string; readonly reasonCode?: string };

export type AttentionReason =
  | 'id_conflict'
  | 'quarantined'
  | 'plan_mismatch'
  | 'untrusted_part_url'
  | 'invalid_server_response'
  | 'invalid_state'
  | 'url_renewal_exhausted'
  | 'upload_incomplete'
  | 'unknown';

export type Outcome =
  | { readonly type: 'uploaded' }
  | { readonly type: 'paused_revoked' }
  | { readonly type: 'device_wipe' }
  | { readonly type: 'paused_update' }
  | { readonly type: 'needs_attention'; readonly reason: AttentionReason }
  | { readonly type: 'retry_checksum' }
  /** `delayMs` is set by the engine (the delay the schedule should respect); the mapping alone leaves it out. */
  | { readonly type: 'retry_later'; readonly delayMs?: number };

/** Session as returned by the server: the server decides the split (fixed part size, the last part smaller, at most 1000 parts). */
export interface SessionInfo {
  readonly id: string;
  readonly partSize: number;
  readonly partCount: number;
}

/** A part confirmed in storage (ListParts). No ETag: the server reads the parts itself at `complete`. */
export interface RemotePart {
  readonly partNumber: number;
  readonly size: number;
}

export interface PartUrl {
  readonly url: string;
  readonly contentLength: number;
}

/** State of the file after `complete` (a `MediaAsset` answer): `state` and `stateReasonCode`. */
export interface CompleteResult {
  readonly state: string;
  readonly reasonCode?: string;
}

/**
 * API host. The adapter refreshes the access token itself and repeats the call once (EVM-130); the engine gets `401` only after a
 * failed refresh. Every failure is an `UploadFailure`.
 */
export interface UploadApi {
  createSession(assetId: string, sessionId: string, idempotencyKey: string): Promise<SessionInfo>;
  listParts(sessionId: string): Promise<readonly RemotePart[]>;
  partUrl(sessionId: string, partNumber: number): Promise<PartUrl>;
  complete(sessionId: string): Promise<CompleteResult>;
}

/** Request of one part: only allowlisted headers (`Content-Length`), never `Authorization`. */
export interface PartRequest {
  readonly url: string;
  readonly offset: number;
  readonly length: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** Storage host. Redirects are not followed. Returns the ETag header when present (informational). */
export interface PartTransport {
  put(request: PartRequest): Promise<string | null>;
}

/** Persisted state of one job: identifiers, sizes and counters only (no tokens, addresses, names or descriptions). */
export interface JobSnapshot {
  readonly schemaVersion: number;
  readonly assetId: string;
  readonly size: number;
  readonly uploadSessionId: string;
  readonly idempotencyKey: string;
  readonly partSize: number | null;
  readonly partCount: number | null;
  readonly completeSent: boolean;
  readonly state: 'active' | 'paused_revoked' | 'uploaded';
  /** Informational only (the server does not trust client ETags). */
  readonly etags: Readonly<Record<string, string>>;
}

export interface JobStore {
  load(assetId: string): Promise<JobSnapshot | null>;
  save(snapshot: JobSnapshot): Promise<void>;
  clear(assetId: string): Promise<void>;
}

export type Checkpoint = 'afterSession' | 'afterPartPut' | 'afterPartSaved' | 'beforeComplete' | 'afterCompleteBeforeSave';

export interface EngineDeps {
  readonly api: UploadApi;
  readonly transport: PartTransport;
  readonly store: JobStore;
  /** Hosts of the storage allowed for part addresses (`host` or `host:port`; the port defaults to 443). */
  readonly allowedHosts: readonly string[];
  readonly sleep: (ms: number) => Promise<void>;
  /** Random number in [0, 1). */
  readonly rng: () => number;
  /** New UUIDv7 (session id, idempotency key). */
  readonly newId: () => string;
  /** Test hook: throwing here simulates the process being killed exactly at this point. */
  readonly checkpoint?: (name: Checkpoint) => void | Promise<void>;
}
