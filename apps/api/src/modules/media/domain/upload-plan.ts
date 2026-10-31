/**
 * The plan of a multipart upload (ADR-0009, media-pipeline.md section 3; EVM-044 AC6): the server decides the size of a part, so the
 * `Content-Length` signed into the URL of part N is known only to the server. Parts of 16 MiB (S3 asks 5 MiB at least for every part
 * but the last), at most 1000 parts. A session lives 7 days (the lifecycle of the bucket removes an unfinished upload then too).
 */
export const PART_SIZE_BYTES = 16 * 1024 * 1024;
export const MAX_PARTS = 1000;
/** The life of the signed URL of a part: exactly one hour (AC6). */
export const PART_URL_SECONDS = 3600;
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Most active sessions one user may hold (429 above; SR-API-02, SR-INFRA-11). */
export const MAX_ACTIVE_SESSIONS_PER_USER = 100;

export interface UploadPlan {
  readonly partSize: number;
  readonly partCount: number;
}

export function planUpload(declaredSize: number): UploadPlan {
  const partCount = Math.ceil(declaredSize / PART_SIZE_BYTES);
  if (declaredSize < 1 || partCount > MAX_PARTS) throw new RangeError('size out of range');
  return { partSize: PART_SIZE_BYTES, partCount };
}

/** @returns the exact length of part `partNumber` (1-based), or `undefined` for a number outside the plan */
export function partLength(declaredSize: number, plan: UploadPlan, partNumber: number): number | undefined {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount) return undefined;
  return partNumber < plan.partCount ? plan.partSize : declaredSize - plan.partSize * (plan.partCount - 1);
}

export interface PartCheck {
  readonly ok: boolean;
  /** `parts_missing`: not every part is stored; `size_mismatch`: a part (or the total) differs from the plan. */
  readonly code?: 'parts_missing' | 'size_mismatch';
}

/** The parts the storage reports must be exactly the planned ones: numbers 1..partCount, every length as planned, the sum = the declaration. */
export function checkStoredParts(
  declaredSize: number,
  plan: UploadPlan,
  stored: ReadonlyArray<{ readonly partNumber: number; readonly size: number }>,
): PartCheck {
  const bySize = new Map(stored.map((part) => [part.partNumber, part.size]));
  for (let n = 1; n <= plan.partCount; n += 1) if (!bySize.has(n)) return { ok: false, code: 'parts_missing' };
  if (stored.length !== plan.partCount) return { ok: false, code: 'size_mismatch' };
  let total = 0;
  for (let n = 1; n <= plan.partCount; n += 1) {
    const size = bySize.get(n) ?? 0;
    if (size !== partLength(declaredSize, plan, n)) return { ok: false, code: 'size_mismatch' };
    total += size;
  }
  return total === declaredSize ? { ok: true } : { ok: false, code: 'size_mismatch' };
}

/** `media/{year}/{month}/{storedFileId}/original` (UTC): assigned by the server, no name, no order number, no personal data (SR-FILE-02). */
export function objectKeyFor(storedFileId: string, at: Date): string {
  const year = String(at.getUTCFullYear()).padStart(4, '0');
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `media/${year}/${month}/${storedFileId}/original`;
}

/** `documents/{year}/{month}/{storedFileId}/original` (UTC) for the file of a document (EVM-047): same rules as {@link objectKeyFor}, no title, no name, no order number. */
export function documentObjectKeyFor(storedFileId: string, at: Date): string {
  return objectKeyFor(storedFileId, at).replace(/^media\//, 'documents/');
}
