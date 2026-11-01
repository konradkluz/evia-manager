/**
 * The plan of the ZIP export of the photos of an order (EVM-052 AC1, AC2; P10; SR-FILE-07, SR-FILE-09; CWE-22). Pure functions of data, no framework.
 *
 * - WHICH files: only the ORIGINAL of a PHOTO that is `ready` (it passed the scan and has its derivatives), not deleted, not erased, pinned to the version
 *   that passed the scan. Films and documents are out of scope (v1); a file in quarantine, held, scanning or uploading never reaches the archive.
 * - The NAMES of the entries: `NNN-<cleaned name>.<extension of the type the SERVER detected>` - the order number makes every name unique, the cleaning
 *   removes separators, `..`, controls, invisible characters and the characters Windows refuses. The original name is personal data of the author of the
 *   photo and is NOT logged or audited anywhere; here it only becomes the (cleaned) name inside the archive, which is the point of the export.
 * - The limits: 10 GB of originals in one export (10 GiB, one constant), at most 5 exports per rolling 24 hours and one per 10 minutes for a user.
 */
import { cleanDownloadName } from './downloads.ts';
import { normalizeContentType, type AllowedContentType } from './file-rules.ts';
import { zipSize } from './zip-writer.ts';

/** 10 GiB of originals in one export (SR-FILE-09; the comment of the message says "10 GB"). */
export const EXPORT_MAX_BYTES = 10 * 1024 ** 3;
/** The life of an export (SR-DATA-07): 24 hours from the request; the link works once. */
export const EXPORT_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const EXPORT_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EXPORT_MAX_PER_WINDOW = 5;
/** One archive holds at most this many photos (a guard of the size of the central directory). */
export const EXPORT_MAX_FILES = 5000;

const EXTENSION_OF_TYPE: Readonly<Record<AllowedContentType, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
const WINDOWS_FORBIDDEN = /[<>:|?*]/g;
const MAX_BASE_POINTS = 100;

/** What the selection needs to know about the file of a medium. */
export interface ExportCandidate {
  readonly mediaAssetId: string;
  readonly mediaType: 'photo' | 'video';
  readonly state: string;
  readonly erased: boolean;
  readonly deleted: boolean;
  readonly purged: boolean;
  readonly versionId: string | null;
  readonly etag: string | null;
  readonly sizeBytes: number | null;
  readonly contentType: string | null;
  readonly originalFilename: string | null;
  readonly objectKey: string;
}

/** A photo that may enter the archive. */
export function isExportable(candidate: ExportCandidate): boolean {
  return (
    candidate.mediaType === 'photo' &&
    candidate.state === 'ready' &&
    !candidate.erased &&
    !candidate.deleted &&
    !candidate.purged &&
    candidate.versionId !== null &&
    candidate.etag !== null &&
    candidate.sizeBytes !== null &&
    candidate.sizeBytes > 0 &&
    candidate.contentType !== null &&
    normalizeContentType(candidate.contentType) !== undefined
  );
}

export interface PlannedEntry {
  readonly name: string;
  readonly size: number;
  readonly mediaAssetId: string;
  readonly objectKey: string;
  readonly versionId: string;
  readonly etag: string;
}

/** The base of a name: cleaned, without the characters Windows refuses, cut; a fallback when nothing is left. */
function baseOf(stored: string | null, type: AllowedContentType): string {
  const extension = EXTENSION_OF_TYPE[type];
  const cleaned = (cleanDownloadName(stored) ?? '').replace(WINDOWS_FORBIDDEN, '').replace(/\.+$/, '').trim();
  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/^\.+/, '').trim();
  const cut = Array.from(stem === '' ? 'photo' : stem)
    .slice(0, MAX_BASE_POINTS)
    .join('')
    .trim();
  return `${cut === '' ? 'photo' : cut}.${extension}`;
}

/** The entries of the archive in a stable order (the order of the list), numbered from 001. */
export function planEntries(candidates: readonly ExportCandidate[]): PlannedEntry[] {
  const exportable = candidates.filter(isExportable);
  const width = Math.max(3, String(exportable.length).length);
  return exportable.map((candidate, index) => {
    const type = normalizeContentType(candidate.contentType ?? '') as AllowedContentType;
    return {
      name: `${String(index + 1).padStart(width, '0')}-${baseOf(candidate.originalFilename, type)}`,
      size: candidate.sizeBytes as number,
      mediaAssetId: candidate.mediaAssetId,
      objectKey: candidate.objectKey,
      versionId: candidate.versionId as string,
      etag: candidate.etag as string,
    };
  });
}

/** The size of the originals of the plan and of the archive (the originals plus the headers). */
export function planSizes(entries: readonly PlannedEntry[]): { readonly contentBytes: number; readonly archiveBytes: number } {
  return {
    contentBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    archiveBytes: zipSize(entries),
  };
}

/** The name of the downloaded archive: built by the SERVER from the number of the order (RFC 6266; never a customer name or an address). */
export function archiveFileName(orderNumber: string): string {
  const safe = orderNumber.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  return `${safe === '' ? 'zlecenie' : safe}-zdjecia.zip`;
}

/** The key of the object of an export: chosen by the server, no name, no number of an order, no customer (SR-FILE-02). */
export function exportObjectKey(exportId: string, at: Date): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `exports/${at.getUTCFullYear()}/${month}/${exportId}.zip`;
}

export type RateDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * The limits of one user (P10): one export per 10 minutes and five per rolling 24 hours. EVERY export counts, a failed one too. `createdAt` are the times of
 * the exports of the user in the last 24 hours. The wait is the time to the earliest moment both rules allow.
 */
export function decideRate(createdAt: readonly Date[], now: Date): RateDecision {
  const times = createdAt.map((value) => value.getTime()).filter((value) => value > now.getTime() - EXPORT_WINDOW_MS);
  const last = times.length === 0 ? undefined : Math.max(...times);
  const waits: number[] = [];
  if (last !== undefined && now.getTime() - last < EXPORT_MIN_INTERVAL_MS) waits.push(last + EXPORT_MIN_INTERVAL_MS - now.getTime());
  if (times.length >= EXPORT_MAX_PER_WINDOW) {
    const oldestThatMatters = [...times].sort((a, b) => a - b)[times.length - EXPORT_MAX_PER_WINDOW] as number;
    waits.push(oldestThatMatters + EXPORT_WINDOW_MS - now.getTime());
  }
  if (waits.length === 0) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) };
}
