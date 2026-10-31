/**
 * What may be uploaded as a document (SR-FILE-01, SR-FILE-03; EVM-047 AC6): PDF, DOCX, XLSX, JPEG and PNG, at most 100 MB, the extension of the name
 * agreeing with the type. SVG, HTML, archives and the macro-enabled formats (`.docm`, `.xlsm`) never start an upload; the type DETECTED from the bytes
 * decides at scan time. Pure functions of data. This is the check of the SERVER; the check of the panel is only a convenience.
 */
import { cleanDownloadName } from './downloads.ts';
import { extensionOf, sanitizeFileName } from './file-rules.ts';

/** 100 MB (SR-FILE-03): the limit of a DOCUMENT. */
export const MAX_DOCUMENT_BYTES = 104_857_600;

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type DocumentContentType = 'application/pdf' | typeof DOCX_TYPE | typeof XLSX_TYPE | 'image/jpeg' | 'image/png';

const EXTENSIONS: Readonly<Record<DocumentContentType, readonly string[]>> = {
  'application/pdf': ['pdf'],
  [DOCX_TYPE]: ['docx'],
  [XLSX_TYPE]: ['xlsx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

const ALIASES: Readonly<Record<string, DocumentContentType>> = { 'image/jpg': 'image/jpeg' };

export const normalizeDocumentType = (value: string): DocumentContentType | undefined => {
  const lower = value.trim().toLowerCase();
  const type = ALIASES[lower] ?? lower;
  return type in EXTENSIONS ? (type as DocumentContentType) : undefined;
};

/** @returns whether the extension of the name belongs to the type */
export const extensionMatches = (type: DocumentContentType, fileName: string): boolean => EXTENSIONS[type].includes(extensionOf(fileName));

/** OOXML containers: the formats whose archive is read for macros. */
export const isOoxml = (type: DocumentContentType): boolean => type === DOCX_TYPE || type === XLSX_TYPE;

export type DocumentDeclarationIssue = 'unsupported_type' | 'invalid_file_name' | 'file_too_large' | 'size_out_of_range';
type Field = 'fileName' | 'contentType' | 'declaredSize';

export interface CheckedDocumentDeclaration {
  readonly contentType: DocumentContentType;
  readonly originalFilename: string;
}

/** @returns the checked declaration, or the issues by field name with a stable code (never the value) */
export function checkDocumentDeclaration(declaration: {
  fileName: string;
  contentType: string;
  declaredSize: number;
}):
  | { readonly ok: true; readonly value: CheckedDocumentDeclaration }
  | { readonly ok: false; readonly issues: ReadonlyArray<{ readonly field: Field; readonly code: DocumentDeclarationIssue }> } {
  const issues: Array<{ field: Field; code: DocumentDeclarationIssue }> = [];
  const originalFilename = sanitizeFileName(declaration.fileName);
  if (originalFilename === undefined) issues.push({ field: 'fileName', code: 'invalid_file_name' });
  const contentType = normalizeDocumentType(declaration.contentType);
  if (contentType === undefined) issues.push({ field: 'contentType', code: 'unsupported_type' });
  else if (originalFilename !== undefined && !EXTENSIONS[contentType].includes(extensionOf(originalFilename))) {
    issues.push({ field: 'fileName', code: 'unsupported_type' });
  }
  if (declaration.declaredSize > MAX_DOCUMENT_BYTES) issues.push({ field: 'declaredSize', code: 'file_too_large' });
  else if (declaration.declaredSize < 1) issues.push({ field: 'declaredSize', code: 'size_out_of_range' });
  if (issues.length > 0 || originalFilename === undefined || contentType === undefined) return { ok: false, issues };
  return { ok: true, value: { contentType, originalFilename } };
}

/** The type detected from the bytes agrees with the declaration AND with the extension of the name. A type outside the allow-list never agrees. */
export function documentTypeAgrees(detected: string | undefined, declared: string, originalFilename: string | null): boolean {
  if (detected === undefined) return false;
  const detectedType = normalizeDocumentType(detected);
  const declaredType = normalizeDocumentType(declared);
  if (detectedType === undefined || declaredType === undefined || detectedType !== declaredType) return false;
  return originalFilename === null || EXTENSIONS[detectedType].includes(extensionOf(originalFilename));
}

/** Only the original of a file that PASSED the scan is released: `clean` or `ready` (a document has no processing, so no `failed` is ever released). */
export const isDocumentOriginalReleasable = (state: string): boolean => state === 'clean' || state === 'ready';

/**
 * The name under which the browser saves a document: the stored name cleaned for the header (`filename*`, RFC 6266), else `dokument-<first 8 of the id>.<extension
 * of the type the SERVER detected>` (CWE-113, CWE-22).
 */
export function documentDownloadName(storedName: string | null, documentId: string, contentType: string | null): string {
  const cleaned = cleanDownloadName(storedName);
  if (cleaned !== undefined) return cleaned;
  const type = contentType === null ? undefined : normalizeDocumentType(contentType);
  return `dokument-${documentId.replace(/-/g, '').slice(0, 8)}.${type === undefined ? 'bin' : (EXTENSIONS[type][0] as string)}`;
}
