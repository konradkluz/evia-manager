/**
 * The check of a chosen file before anything is sent (EVM-044 AC2; SR-FILE-01, SR-FILE-03): only JPEG, PNG, WebP and HEIC up to
 * 50 MB. The check goes by the declared type and the extension; the server checks the CONTENT again after the upload (a `.jpg` with
 * other content ends in quarantine as `type_mismatch`), so this is a convenience, not a control.
 */
export const MAX_FILE_BYTES = 52_428_800;
/** The batch limit of the API (`maxItems`). */
export const MAX_BATCH = 50;

const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
};

const BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heif': 'image/heic',
};

export type FileCheck =
  { readonly ok: true; readonly contentType: string } | { readonly ok: false; readonly reason: 'format' | 'size' | 'empty' };

/** The content type the API accepts for a file (the extension decides when the browser gives none), or the reason to refuse it. */
export function checkFile(file: { readonly name: string; readonly type: string; readonly size: number }): FileCheck {
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const fromExtension = BY_EXTENSION[extension];
  const fromType = BY_TYPE[file.type.toLowerCase()];
  // SVG, HTML and archives have a type and an extension of their own: both must agree with the allowed list.
  if (fromExtension === undefined || (file.type !== '' && fromType === undefined)) return { ok: false, reason: 'format' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, contentType: fromType ?? fromExtension };
}
