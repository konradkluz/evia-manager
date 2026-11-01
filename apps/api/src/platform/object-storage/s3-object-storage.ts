/**
 * The adapter of the object-storage port over the S3 API (the only importer of `@aws-sdk/*` besides the deletion register; the rule
 * `api-aws-sdk-only-in-storage-adapters`). Settings that matter for security (media-pipeline.md section 5):
 * - `requestChecksumCalculation: 'WHEN_REQUIRED'` — the SDK adds no flexible checksum that would be signed into the URL and break a plain browser `PUT`;
 * - the part URL signs `Content-Length`, `partNumber`, `uploadId` and the key; its life is at most {@link MAX_PRESIGN_SECONDS};
 * - the connection, the wait for the response (`throwOnRequestTimeout`: without it the SDK only warns) and the idle time of the socket have
 *   a timeout, so a hung storage ends as `unavailable` (the caller answers `503`) and never holds a database transaction open; the idle
 *   time also bounds a stalled stream of the scan;
 * - the SDK logger is switched off: a signed URL or a response of the SDK is never written to a log (SR-LOG-02, SR-LOG-03).
 * It is exercised against a real S3 server (SeaweedFS, Testcontainers) by the integration test.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import {
  DERIVATIVE_URL_SECONDS,
  MAX_PRESIGN_SECONDS,
  ObjectStorageError,
  type CompletedObject,
  type ObjectHead,
  type ObjectPage,
  type ObjectStorage,
  type ObjectStorageErrorCode,
  type PartUrl,
  type SignedGetInput,
  type StoredPart,
} from './object-storage.ts';
import { dispositionHeader } from './content-disposition.ts';

export interface S3ObjectStorageSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  /** Overrides of {@link DEFAULT_TIMEOUTS} (tests only). */
  readonly timeouts?: { readonly connectionMs: number; readonly requestMs: number };
}

/** Control operations answer in well under a second; a few seconds means the storage hangs. */
export const DEFAULT_TIMEOUTS = { connectionMs: 3000, requestMs: 8000 } as const;
/** One try and one retry: a request of a user waits at most about twice the timeout. */
export const MAX_ATTEMPTS = 2;

const NOOP_LOGGER = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

export function createS3Client(settings: S3ObjectStorageSettings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    logger: NOOP_LOGGER,
    maxAttempts: MAX_ATTEMPTS,
    requestHandler: {
      connectionTimeout: (settings.timeouts ?? DEFAULT_TIMEOUTS).connectionMs,
      requestTimeout: (settings.timeouts ?? DEFAULT_TIMEOUTS).requestMs,
      socketTimeout: (settings.timeouts ?? DEFAULT_TIMEOUTS).requestMs,
      throwOnRequestTimeout: true,
    },
  });
}

/** Names of the S3 errors (the SDK sets `name`; a message is never used). */
const NO_SUCH_UPLOAD = new Set(['NoSuchUpload']);
const NO_SUCH_OBJECT = new Set(['NoSuchKey', 'NotFound', 'NoSuchVersion']);

/** Maps whatever the SDK threw to a fixed code. @internal exported for the unit test */
export function translateS3Error(error: unknown): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;
  const name = error instanceof Error ? error.name : '';
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  let code: ObjectStorageErrorCode = 'unavailable';
  if (NO_SUCH_UPLOAD.has(name)) code = 'no_such_upload';
  else if (NO_SUCH_OBJECT.has(name) || status === 404) code = 'no_such_object';
  else if (name === 'PreconditionFailed' || status === 412) code = 'precondition_failed';
  return new ObjectStorageError(code);
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #now: () => Date;

  constructor(client: S3Client, bucket: string, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#bucket = bucket;
    this.#now = now;
  }

  async createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    try {
      const out = await this.#client.send(new CreateMultipartUploadCommand({ Bucket: this.#bucket, Key: key, ContentType: contentType }));
      if (out.UploadId === undefined) throw new ObjectStorageError('unavailable');
      return { uploadId: out.UploadId };
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async presignUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<PartUrl> {
    if (input.expiresInSeconds < 1 || input.expiresInSeconds > MAX_PRESIGN_SECONDS) throw new RangeError('presign lifetime out of range');
    try {
      const command = new UploadPartCommand({
        Bucket: this.#bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        ContentLength: input.contentLength,
      });
      // Content-Length is signed so a part of another size is refused by the storage (AC6); the browser sets it from the body.
      const url = await getSignedUrl(this.#client, command, {
        expiresIn: input.expiresInSeconds,
        signableHeaders: new Set(['content-length']),
      });
      return { url, expiresAt: new Date(this.#now().getTime() + input.expiresInSeconds * 1000) };
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async listParts(key: string, uploadId: string): Promise<readonly StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;
    try {
      for (let page = 0; page < 20; page += 1) {
        const out = await this.#client.send(
          new ListPartsCommand({
            Bucket: this.#bucket,
            Key: key,
            UploadId: uploadId,
            MaxParts: 1000,
            ...(marker === undefined ? {} : { PartNumberMarker: marker }),
          }),
        );
        for (const part of out.Parts ?? []) {
          if (part.PartNumber === undefined || part.Size === undefined || part.ETag === undefined) continue;
          parts.push({ partNumber: part.PartNumber, size: part.Size, etag: part.ETag });
        }
        if (out.IsTruncated !== true || out.NextPartNumberMarker === undefined) break;
        marker = out.NextPartNumberMarker;
      }
    } catch (error) {
      throw translateS3Error(error);
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: readonly StoredPart[]): Promise<CompletedObject> {
    try {
      const out = await this.#client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.#bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
        }),
      );
      if (out.ETag === undefined) throw new ObjectStorageError('unavailable');
      return { etag: out.ETag, versionId: out.VersionId };
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.#client.send(new AbortMultipartUploadCommand({ Bucket: this.#bucket, Key: key, UploadId: uploadId }));
    } catch (error) {
      const translated = translateS3Error(error);
      if (translated.code !== 'no_such_upload') throw translated;
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch (error) {
      const translated = translateS3Error(error);
      if (translated.code !== 'no_such_object') throw translated;
    }
  }

  async listObjects(prefix: string, limit: number, token?: string): Promise<ObjectPage> {
    try {
      const out = await this.#client.send(
        new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, MaxKeys: limit, ContinuationToken: token }),
      );
      const keys = (out.Contents ?? []).flatMap((object) => (object.Key === undefined ? [] : [object.Key]));
      return { keys, nextToken: out.IsTruncated === true ? out.NextContinuationToken : undefined };
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async head(key: string): Promise<ObjectHead | undefined> {
    try {
      const out = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      if (out.ContentLength === undefined || out.ETag === undefined) throw new ObjectStorageError('unavailable');
      return { size: out.ContentLength, etag: out.ETag, versionId: out.VersionId };
    } catch (error) {
      const translated = translateS3Error(error);
      if (translated.code === 'no_such_object') return undefined;
      throw translated;
    }
  }

  async getObjectStream(key: string, pin: { versionId?: string; ifMatch?: string }): Promise<Readable> {
    try {
      const out = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          ...(pin.versionId === undefined ? {} : { VersionId: pin.versionId }),
          ...(pin.ifMatch === undefined ? {} : { IfMatch: pin.ifMatch }),
        }),
      );
      if (out.Body === undefined) throw new ObjectStorageError('unavailable');
      return out.Body as Readable;
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async putObjectIfAbsent(input: { key: string; body: Buffer; contentType: string; cacheControl: string }): Promise<void> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.key,
          Body: input.body,
          ContentLength: input.body.length,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async putObjectStreamIfAbsent(input: {
    key: string;
    body: Readable;
    size: number;
    contentType: string;
    cacheControl: string;
  }): Promise<void> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.key,
          Body: input.body,
          ContentLength: input.size,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
          IfNoneMatch: '*',
        }),
      );
    } catch (error) {
      throw translateS3Error(error);
    }
  }

  async presignGet(input: SignedGetInput): Promise<PartUrl> {
    if (input.expiresInSeconds < 1 || input.expiresInSeconds > DERIVATIVE_URL_SECONDS)
      throw new RangeError('presign lifetime out of range');
    const disposition = dispositionHeader(input.disposition);
    try {
      const command = new GetObjectCommand({
        Bucket: this.#bucket,
        Key: input.key,
        ResponseContentType: input.contentType,
        ...(input.versionId === undefined ? {} : { VersionId: input.versionId }),
        ResponseContentDisposition: disposition,
        ResponseCacheControl: input.cacheControl,
      });
      const url = await getSignedUrl(this.#client, command, { expiresIn: input.expiresInSeconds });
      return { url, expiresAt: new Date(this.#now().getTime() + input.expiresInSeconds * 1000) };
    } catch (error) {
      throw translateS3Error(error);
    }
  }
}
