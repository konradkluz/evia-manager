// What the panel lets into the dialog "Dodaj dokument" (SR-FILE-01; AC6): PDF, DOCX, XLSX, JPG, PNG up to 100 MB, by the extension. A convenience only -
// the server checks the type, the extension and the size again and the scan reads the content (macros and a type that differs from the extension
// end in quarantine). `.docm` and `.xlsm` (macros), SVG, HTML and archives have no entry here, so they are refused before anything is sent.

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

const TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export const DOCUMENT_ACCEPT = Object.keys(TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

export type DocumentFileVerdict =
  { readonly ok: true; readonly contentType: string } | { readonly ok: false; readonly reason: 'type' | 'size' | 'empty' };

/** The verdict for a chosen file; the content type is the one of the extension (the browser's own `file.type` can be empty or wrong). */
export function checkDocumentFile(file: { readonly name: string; readonly size: number }): DocumentFileVerdict {
  const dot = file.name.lastIndexOf('.');
  const contentType = dot === -1 ? undefined : TYPES[file.name.slice(dot + 1).toLowerCase()];
  if (contentType === undefined) return { ok: false, reason: 'type' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, contentType };
}
