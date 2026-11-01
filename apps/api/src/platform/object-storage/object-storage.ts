/**
 * The port of the private object storage (ADR-0009; EVM-044): the modules know this interface, never the S3 SDK (the adapter `s3-object-storage.ts`
 * is the only file that imports it). The bucket is private and versioned; a client reaches it only through a signed URL of one part. Keys are
 * assigned by the server and carry no name, order number or personal data (SR-FILE-02). Errors leave the port as {@link ObjectStorageError}
 * with a fixed code — a message of the SDK may name the bucket, the request id or the path (SR-ERR-01) and never travels further.
 */
import type { Readable } from 'node:stream';
import type { Disposition } from './content-disposition.ts';

export type { Disposition };

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type ObjectStorageErrorCode = 'no_such_upload' | 'no_such_object' | 'precondition_failed' | 'unavailable';

export class ObjectStorageError extends Error {
  readonly code: ObjectStorageErrorCode;

  constructor(code: ObjectStorageErrorCode) {
    super(code);
    this.name = 'ObjectStorageError';
    this.code = code;
  }
}

/** The longest life of a signed URL (P5, SR-FILE-02): a longer value is refused in code, not trusted to the caller. */
export const MAX_PRESIGN_SECONDS = 3600;

export interface StoredPart {
  readonly partNumber: number;
  readonly size: number;
  readonly etag: string;
}

export interface ObjectHead {
  readonly size: number;
  readonly etag: string;
  readonly versionId: string | undefined;
}

export interface ListedObject {
  readonly key: string;
  /** When the current version was written (the reconciliation leaves the young ones alone). */
  readonly modifiedAt: Date;
}

export interface ObjectPage {
  readonly objects: readonly ListedObject[];
  readonly nextToken: string | undefined;
}

export interface CompletedObject {
  readonly etag: string;
  readonly versionId: string | undefined;
}

export interface PartUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

/**
 * The life of a signed `GET` of a derivative (EVM-068 AC6, SR-FILE-07): a constant of the server, never a parameter of the caller — a longer
 * value is refused by the adapter, not trusted to the service.
 */
export const DERIVATIVE_URL_SECONDS = 300;

/**
 * A signed `GET`: the type, the disposition and the cache control are forced by the SERVER in the signed query (a derivative is served
 * `inline`, an original as an `attachment` with a name the server has cleaned - EVM-045). `versionId` pins the version of the object that
 * passed the scan (TOCTOU, SR-FILE-05, CWE-367): an overwritten object is never served instead of the scanned one.
 */
export interface SignedGetInput {
  readonly key: string;
  readonly versionId?: string | undefined;
  readonly disposition: Disposition;
  readonly expiresInSeconds: number;
  readonly contentType: string;
  readonly cacheControl: string;
}

export interface ObjectStorage {
  /** The content type is set by the server from an allow-list — never taken from the declaration of the client (SR-WEB-04). */
  createMultipartUpload(key: string, contentType: string): Promise<{ readonly uploadId: string }>;
  /** A signed `PUT` of one part: bound to the key, the upload, the part number and the exact `Content-Length`. */
  presignUploadPart(input: {
    readonly key: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly contentLength: number;
    readonly expiresInSeconds: number;
  }): Promise<PartUrl>;
  /** All parts stored so far, by number (the server never trusts the ETags a client sends). @throws ObjectStorageError `no_such_upload` */
  listParts(key: string, uploadId: string): Promise<readonly StoredPart[]>;
  /** @throws ObjectStorageError `no_such_upload` (e.g. a repeat after the object was assembled) */
  completeMultipartUpload(key: string, uploadId: string, parts: readonly StoredPart[]): Promise<CompletedObject>;
  /** Idempotent: an unknown upload is not an error. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /**
   * Removes the object the way a versioned bucket does: a DeleteObject WITHOUT a version (a delete marker; ADR-0009: object lock in governance mode
   * and no bypass for the application). The older versions go with the lifecycle of the bucket (noncurrent expiration). Idempotent: a missing
   * object is not an error.
   */
  deleteObject(key: string): Promise<void>;
  /**
   * One page of the keys of the CURRENT objects under a prefix (no delete markers, no older versions), in key order (EVM-051 AC5, SR-FILE-11: the
   * reconciliation). `nextToken` is opaque; `undefined` ends the listing. Needs the permission to list the bucket: the key of the worker has it, a key
   * handed to a client never does.
   */
  listObjects(prefix: string, limit: number, token?: string): Promise<ObjectPage>;
  /** @returns `undefined` when there is no such object */
  head(key: string): Promise<ObjectHead | undefined>;
  /** One read of a pinned version (`versionId`) and, when given, of the exact ETag (`ifMatch`): the three verdicts concern the same bytes. */
  getObjectStream(key: string, pin: { readonly versionId?: string; readonly ifMatch?: string }): Promise<Readable>;
  /**
   * Writes a whole object ONLY when the key is free (`If-None-Match: *`; add-only: a derivative is never overwritten, and a key of an original is
   * never reachable with the key of the worker). The type and the cache control are set by the server (SR-WEB-04).
   * @throws ObjectStorageError `precondition_failed` when the object already exists (the caller decides whether that is a success)
   */
  putObjectIfAbsent(input: {
    readonly key: string;
    readonly body: Buffer;
    readonly contentType: string;
    readonly cacheControl: string;
  }): Promise<void>;
  /**
   * The same as {@link putObjectIfAbsent} for a body that is NOT held in memory (the 720p preview of a video, up to 1 GiB): a stream of exactly `size` bytes
   * (a stream of another length is an error and nothing is stored).
   * @throws ObjectStorageError `precondition_failed` when the object already exists
   */
  putObjectStreamIfAbsent(input: {
    readonly key: string;
    readonly body: Readable;
    readonly size: number;
    readonly contentType: string;
    readonly cacheControl: string;
  }): Promise<void>;
  /** A signed `GET` for the browser: `response-content-type`, `response-content-disposition`, the version and `response-cache-control` are signed. */
  presignGet(input: SignedGetInput): Promise<PartUrl>;
}
