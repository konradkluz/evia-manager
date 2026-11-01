/**
 * An in-memory object storage for the tests of the units (EVM-044): the same port, no network. It models what the services rely on —
 * multipart uploads with parts stored by number, a versioned bucket (an overwrite keeps the older version), `NoSuchUpload` after the
 * assembly — and offers `putPart` as the stand-in of the browser `PUT` to the signed URL. The real server is covered by the integration test.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DERIVATIVE_URL_SECONDS,
  MAX_PRESIGN_SECONDS,
  ObjectStorageError,
  type CompletedObject,
  type ObjectHead,
  type ObjectPage,
  type ObjectStorage,
  type PartUrl,
  type SignedGetInput,
  type StoredPart,
} from './object-storage.ts';
import { dispositionHeader } from './content-disposition.ts';

interface Upload {
  readonly key: string;
  readonly contentType: string;
  readonly parts: Map<number, Buffer>;
}

interface Version {
  readonly versionId: string;
  readonly etag: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly cacheControl?: string;
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly #uploads = new Map<string, Upload>();
  readonly #objects = new Map<string, Version[]>();
  /** Keys with a delete marker on top (a versioned bucket: the older versions stay readable by their version id). */
  readonly #markers = new Set<string>();
  /** When each key was last written (the listing reports it). */
  readonly #modified = new Map<string, Date>();
  readonly #now: () => Date;
  #counter = 0;
  /** When set, every call fails like an unreachable storage (`unavailable`). */
  unavailable = false;
  /** The lengths and part numbers of the URLs handed out, for assertions. */
  readonly presigned: Array<{ key: string; partNumber: number; contentLength: number; expiresInSeconds: number }> = [];
  /** The signed `GET` URLs handed out, for assertions. */
  readonly signedGets: SignedGetInput[] = [];
  /** Content types the uploads were created with. */
  readonly contentTypes: string[] = [];

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    this.#counter += 1;
    const uploadId = `upload-${this.#counter}`;
    this.#uploads.set(uploadId, { key, contentType, parts: new Map() });
    this.contentTypes.push(contentType);
    return Promise.resolve({ uploadId });
  }

  presignUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<PartUrl> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    if (input.expiresInSeconds < 1 || input.expiresInSeconds > MAX_PRESIGN_SECONDS) throw new RangeError('presign lifetime out of range');
    this.presigned.push({
      key: input.key,
      partNumber: input.partNumber,
      contentLength: input.contentLength,
      expiresInSeconds: input.expiresInSeconds,
    });
    const url = `https://bucket.invalid/${input.key}?uploadId=${input.uploadId}&partNumber=${input.partNumber}&X-Amz-Signature=synthetic`;
    return Promise.resolve({ url, expiresAt: new Date(this.#now().getTime() + input.expiresInSeconds * 1000) });
  }

  /** The browser `PUT` of a part (a test helper, not part of the port). */
  putPart(uploadId: string, partNumber: number, body: Buffer): void {
    const upload = this.#uploads.get(uploadId);
    if (upload === undefined) throw new ObjectStorageError('no_such_upload');
    upload.parts.set(partNumber, body);
  }

  listParts(_key: string, uploadId: string): Promise<readonly StoredPart[]> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    const upload = this.#uploads.get(uploadId);
    if (upload === undefined) return Promise.reject(new ObjectStorageError('no_such_upload'));
    const parts = [...upload.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([partNumber, body]) => ({ partNumber, size: body.length, etag: `"${md5(body)}"` }));
    return Promise.resolve(parts);
  }

  completeMultipartUpload(key: string, uploadId: string, parts: readonly StoredPart[]): Promise<CompletedObject> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    const upload = this.#uploads.get(uploadId);
    if (upload === undefined) return Promise.reject(new ObjectStorageError('no_such_upload'));
    const bodies: Buffer[] = [];
    for (const part of parts) {
      const stored = upload.parts.get(part.partNumber);
      if (stored === undefined) return Promise.reject(new ObjectStorageError('unavailable'));
      bodies.push(stored);
    }
    const body = Buffer.concat(bodies);
    this.#counter += 1;
    const version: Version = {
      versionId: `version-${this.#counter}`,
      etag: `"${md5(body)}-${parts.length}"`,
      body,
      contentType: upload.contentType,
    };
    this.#modified.set(key, this.#now());
    this.#objects.set(key, [...(this.#objects.get(key) ?? []), version]);
    this.#markers.delete(key);
    this.#uploads.delete(uploadId);
    return Promise.resolve({ etag: version.etag, versionId: version.versionId });
  }

  abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    this.#uploads.delete(uploadId);
    return Promise.resolve();
  }

  deleteObject(key: string): Promise<void> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    if (this.#objects.has(key)) this.#markers.add(key);
    return Promise.resolve();
  }

  listObjects(prefix: string, limit: number, token?: string): Promise<ObjectPage> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    const keys = this.currentKeys().filter((key) => key.startsWith(prefix));
    const rest = token === undefined ? keys : keys.filter((key) => key > token);
    const page = rest.slice(0, limit);
    const objects = page.map((key) => ({ key, modifiedAt: this.#modified.get(key) ?? this.#now() }));
    return Promise.resolve({ objects, nextToken: rest.length > limit ? page.at(-1) : undefined });
  }

  /** Test helper: the keys of the objects a plain read still finds (no delete marker on top), in key order. */
  currentKeys(): string[] {
    return [...this.#objects.keys()].filter((key) => !this.#markers.has(key)).sort();
  }

  head(key: string): Promise<ObjectHead | undefined> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    const latest = this.#markers.has(key) ? undefined : this.#objects.get(key)?.at(-1);
    return Promise.resolve(latest === undefined ? undefined : { size: latest.body.length, etag: latest.etag, versionId: latest.versionId });
  }

  getObjectStream(key: string, pin: { versionId?: string; ifMatch?: string }): Promise<Readable> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    const versions = this.#objects.get(key) ?? [];
    const latest = this.#markers.has(key) ? undefined : versions.at(-1);
    const version = pin.versionId === undefined ? latest : versions.find((candidate) => candidate.versionId === pin.versionId);
    if (version === undefined) return Promise.reject(new ObjectStorageError('no_such_object'));
    if (pin.ifMatch !== undefined && pin.ifMatch !== version.etag) return Promise.reject(new ObjectStorageError('precondition_failed'));
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < version.body.length; offset += 65_536) chunks.push(version.body.subarray(offset, offset + 65_536));
    return Promise.resolve(Readable.from(chunks, { objectMode: false }));
  }

  putObjectIfAbsent(input: { key: string; body: Buffer; contentType: string; cacheControl: string }): Promise<void> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    if ((this.#objects.get(input.key)?.length ?? 0) > 0) return Promise.reject(new ObjectStorageError('precondition_failed'));
    this.#counter += 1;
    this.#modified.set(input.key, this.#now());
    this.#objects.set(input.key, [
      {
        versionId: `version-${this.#counter}`,
        etag: `"${md5(input.body)}"`,
        body: input.body,
        contentType: input.contentType,
        cacheControl: input.cacheControl,
      },
    ]);
    return Promise.resolve();
  }

  async putObjectStreamIfAbsent(input: {
    key: string;
    body: Readable;
    size: number;
    contentType: string;
    cacheControl: string;
  }): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.from(chunk as Uint8Array));
    const body = Buffer.concat(chunks);
    if (body.length !== input.size) throw new ObjectStorageError('unavailable');
    await this.putObjectIfAbsent({ key: input.key, body, contentType: input.contentType, cacheControl: input.cacheControl });
  }

  presignGet(input: SignedGetInput): Promise<PartUrl> {
    if (this.unavailable) return Promise.reject(new ObjectStorageError('unavailable'));
    if (input.expiresInSeconds < 1 || input.expiresInSeconds > DERIVATIVE_URL_SECONDS)
      throw new RangeError('presign lifetime out of range');
    const disposition = dispositionHeader(input.disposition);
    this.signedGets.push({ ...input });
    const version = input.versionId === undefined ? '' : `&versionId=${encodeURIComponent(input.versionId)}`;
    const url = `https://bucket.invalid/${input.key}?response-content-type=${encodeURIComponent(input.contentType)}&response-content-disposition=${encodeURIComponent(disposition)}&X-Amz-Expires=${input.expiresInSeconds}${version}&X-Amz-Signature=synthetic`;
    return Promise.resolve({ url, expiresAt: new Date(this.#now().getTime() + input.expiresInSeconds * 1000) });
  }

  /** Test helper: the bytes, type and cache control of the latest version of an object (`undefined`: none). */
  read(key: string): { body: Buffer; contentType: string; cacheControl: string | undefined } | undefined {
    const latest = this.#objects.get(key)?.at(-1);
    return latest === undefined ? undefined : { body: latest.body, contentType: latest.contentType, cacheControl: latest.cacheControl };
  }

  /** Test helper: puts a whole object as one version (as if assembled by a complete). */
  putObject(key: string, body: Buffer): CompletedObject {
    this.#counter += 1;
    const version: Version = {
      versionId: `version-${this.#counter}`,
      etag: `"${md5(body)}-1"`,
      body,
      contentType: 'application/octet-stream',
    };
    this.#modified.set(key, this.#now());
    this.#objects.set(key, [...(this.#objects.get(key) ?? []), version]);
    this.#markers.delete(key);
    return { etag: version.etag, versionId: version.versionId };
  }

  /** Test helper: forgets every object, marker and upload (a test that counts what is in the bucket starts from nothing). */
  reset(): void {
    this.#objects.clear();
    this.#markers.clear();
    this.#modified.clear();
    this.#uploads.clear();
  }

  /** Test helper: whether the key has a delete marker on top (the object is gone for a plain read). */
  isDeleted(key: string): boolean {
    return this.#markers.has(key);
  }

  versionsOf(key: string): number {
    return this.#objects.get(key)?.length ?? 0;
  }
}

function md5(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
