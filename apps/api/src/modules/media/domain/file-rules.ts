/**
 * What may be uploaded as a photo or a video (SR-FILE-01, SR-FILE-03; EVM-044 AC2): the allow-list of types, the extensions that match them, the
 * size limit and the cleaning of the file name. Pure functions of data. The type is decided by the CONTENT at scan time (`file-type`
 * on the first bytes); the declaration checked here only keeps obviously unsupported files (SVG, HTML, archives, anything above
 * 50 MB) from starting an upload at all.
 */

/** 50 MB (SR-FILE-03): the limit of a PHOTO. */
export const MAX_FILE_BYTES = 52_428_800;
/** 4 GiB (ADR-0009; EVM-046 AC1): the limit of a VIDEO. */
export const MAX_VIDEO_BYTES = 4_294_967_296;

export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
export type VideoContentType = 'video/mp4' | 'video/quicktime';
export type AllowedContentType = PhotoContentType | VideoContentType;
export type MediaKind = 'photo' | 'video';

const EXTENSIONS: Readonly<Record<AllowedContentType, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic', 'heif'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mov'],
};

/** The kind of medium a type belongs to; the server derives it from the type, never from a field of the client (EVM-046 AC1). */
export const mediaKindOf = (type: AllowedContentType): MediaKind => (type.startsWith('video/') ? 'video' : 'photo');

/** `image/heif` is the same family as `image/heic` (file-type reports either, depending on the brand). */
const ALIASES: Readonly<Record<string, AllowedContentType>> = { 'image/jpg': 'image/jpeg', 'image/heif': 'image/heic' };

export const normalizeContentType = (value: string): AllowedContentType | undefined => {
  const lower = value.trim().toLowerCase();
  const type = ALIASES[lower] ?? lower;
  return type in EXTENSIONS ? (type as AllowedContentType) : undefined;
};

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
};

/** @returns whether the extension belongs to the type (the declaration and the name must agree) */
export const extensionMatches = (type: AllowedContentType, fileName: string): boolean => EXTENSIONS[type].includes(extensionOf(fileName));

/** Controls (C0, C1) and the invisible characters that reorder or hide text (bidi embeddings and isolates, zero width, BOM). */
const FORBIDDEN_NAME_CHARS = new RegExp('[\\p{Cc}\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]', 'gu');
const MAX_NAME_CODE_POINTS = 255;

/**
 * The file name as it is stored (SR-DATA-01, SR-WEB-03): the last path segment, NFC, without control and bidi characters, trimmed,
 * at most 255 code points. It is metadata shown as TEXT in the panel — never part of a key, a log, an audit record or a journal payload.
 * @returns `undefined` when nothing is left
 */
export function sanitizeFileName(raw: string): string | undefined {
  const segment = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = segment.replace(FORBIDDEN_NAME_CHARS, '').trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined;
  const points = Array.from(cleaned);
  return (points.length > MAX_NAME_CODE_POINTS ? points.slice(0, MAX_NAME_CODE_POINTS).join('') : cleaned).trim() || undefined;
}

export type DeclarationIssue = 'unsupported_type' | 'invalid_file_name' | 'file_too_large' | 'size_out_of_range';

export interface Declaration {
  readonly fileName: string;
  readonly contentType: string;
  readonly declaredSize: number;
}

export interface CheckedDeclaration {
  readonly contentType: AllowedContentType;
  readonly mediaType: MediaKind;
  readonly originalFilename: string;
}

/** @returns the checked declaration, or the issues by field name (`fileName`, `contentType`, `declaredSize`) with a stable code */
export function checkDeclaration(declaration: Declaration):
  | { readonly ok: true; readonly value: CheckedDeclaration }
  | {
      readonly ok: false;
      readonly issues: ReadonlyArray<{ readonly field: 'fileName' | 'contentType' | 'declaredSize'; readonly code: DeclarationIssue }>;
    } {
  const issues: Array<{ field: 'fileName' | 'contentType' | 'declaredSize'; code: DeclarationIssue }> = [];
  const originalFilename = sanitizeFileName(declaration.fileName);
  if (originalFilename === undefined) issues.push({ field: 'fileName', code: 'invalid_file_name' });
  const contentType = normalizeContentType(declaration.contentType);
  if (contentType === undefined) issues.push({ field: 'contentType', code: 'unsupported_type' });
  else if (originalFilename !== undefined && !extensionMatches(contentType, originalFilename))
    issues.push({ field: 'fileName', code: 'unsupported_type' });
  const limit = contentType !== undefined && mediaKindOf(contentType) === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (declaration.declaredSize > limit) issues.push({ field: 'declaredSize', code: 'file_too_large' });
  else if (declaration.declaredSize < 1) issues.push({ field: 'declaredSize', code: 'size_out_of_range' });
  if (issues.length > 0 || originalFilename === undefined || contentType === undefined) return { ok: false, issues };
  return { ok: true, value: { contentType, mediaType: mediaKindOf(contentType), originalFilename } };
}

/**
 * Whether the type detected from the bytes agrees with the declaration AND the extension of the name (AC2: a `.jpg` that is not a
 * JPEG is quarantined as `type_mismatch`). A detected type outside the allow-list never agrees.
 */
export function typeAgrees(detected: string | undefined, declared: string, originalFilename: string | null): boolean {
  if (detected === undefined) return false;
  const detectedType = normalizeContentType(detected);
  const declaredType = normalizeContentType(declared);
  if (detectedType === undefined || declaredType === undefined) return false;
  // MP4 and MOV are one family (ISO base media): a phone writes `.mov` with an `isom` brand and the reverse. The structure is judged by ffprobe
  // (EVM-046 AC2); here only the family and the extension of the DECLARED type must agree.
  if (mediaKindOf(declaredType) === 'video') {
    return mediaKindOf(detectedType) === 'video' && (originalFilename === null || extensionMatches(declaredType, originalFilename));
  }
  if (detectedType !== declaredType) return false;
  return originalFilename === null || extensionMatches(detectedType, originalFilename);
}
