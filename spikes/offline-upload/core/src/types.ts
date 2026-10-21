// Protocol types shared by the reference engine, the url-issuer and the tests.

export interface Session {
  uploadId: string;
  /** Server-assigned object key: media/{year}/{month}/{assetId}/original (never derived from a file name). */
  key: string;
  partSize: number;
  partCount: number;
}

export interface RemotePart {
  number: number;
  etag: string;
  size: number;
}

export interface CreateSessionRequest {
  assetId: string;
  deviceId: string;
  size: number;
  sha256: string;
  contentType: string;
}

export interface ListPartsResult {
  /** True when the multipart upload no longer exists because the object was already assembled. */
  completed: boolean;
  parts: RemotePart[];
}

export interface CompleteResult {
  status: 'completed' | 'already_complete';
  size: number;
}

/** API stand-in (the url-issuer in the spike; the real API in M2). */
export interface UploadApi {
  createSession(req: CreateSessionRequest): Promise<Session>;
  listParts(assetId: string): Promise<ListPartsResult>;
  partUrl(assetId: string, partNumber: number): Promise<{ url: string; expiresAt: string }>;
  complete(assetId: string, parts: { number: number; etag: string }[]): Promise<CompleteResult>;
}

export interface PartTransport {
  put(url: string, filePath: string, offset: number, length: number): Promise<{ etag: string }>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super('api error ' + status + ' ' + code);
    this.status = status;
    this.code = code;
  }
}

/** Failure of a part PUT: `status` is the HTTP status when the server answered, undefined for network errors. */
export class TransportError extends Error {
  readonly status: number | undefined;
  constructor(status: number | undefined) {
    super(status === undefined ? 'network error' : 'http ' + status);
    this.status = status;
  }
}

export type JobState = 'pending' | 'uploading' | 'uploaded' | 'verified' | 'local_deleted' | 'paused_revoked' | 'failed';

export interface Metrics {
  /** PUT attempts that did not produce an ETag (network error, 5xx) and were repeated. */
  retries: number;
  /** URL renewals after 403 (expired signature). */
  renewals: number;
  /** Successful part PUTs. */
  partPuts: number;
  /** Bytes of parts that were PUT again although an ETag was already known (should be 0 or very small). */
  wastedBytes: number;
  /** Parts that were skipped on resume because ListParts already had them. */
  skippedParts: number;
}

export interface UploadJob {
  assetId: string;
  deviceId: string;
  filePath: string;
  size: number;
  sha256: string;
  contentType: string;
  state: JobState;
  session?: Session;
  etags: Record<number, string>;
  metrics: Metrics;
  startedAt?: number;
  finishedAt?: number;
}

export interface JobStore {
  load(assetId: string): Promise<UploadJob | undefined>;
  save(job: UploadJob): Promise<void>;
}

export const emptyMetrics = (): Metrics => ({ retries: 0, renewals: 0, partPuts: 0, wastedBytes: 0, skippedParts: 0 });
