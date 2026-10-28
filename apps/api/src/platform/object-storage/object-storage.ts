/**
 * The port of the private object storage (ADR-0009; EVM-044): the modules know this interface, never the S3 SDK (the adapter `s3-object-storage.ts`
 * is the only file that imports it). The bucket is private and versioned; a client reaches it only through a signed URL of one part. Keys are
 * assigned by the server and carry no name, order number or personal data (SR-FILE-02). Errors leave the port as {@link ObjectStorageError}
 * with a fixed code — a message of the SDK may name the bucket, the request id or the path (SR-ERR-01) and never travels further.
 */
import type { Readable } from 'node:stream';

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

export interface CompletedObject {
  readonly etag: string;
  readonly versionId: string | undefined;
}

export interface PartUrl {
  readonly url: string;
  readonly expiresAt: Date;
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
  /** @returns `undefined` when there is no such object */
  head(key: string): Promise<ObjectHead | undefined>;
  /** One read of a pinned version (`versionId`) and, when given, of the exact ETag (`ifMatch`): the three verdicts concern the same bytes. */
  getObjectStream(key: string, pin: { readonly versionId?: string; readonly ifMatch?: string }): Promise<Readable>;
}
