/**
 * The verdict on the TYPE of a scanned document (EVM-047 AC6; SR-FILE-03, SR-FILE-06): a pure function of what the ONE pass of the scan kept - the type that
 * `file-type` detected in the first bytes, the first bytes and the last bytes of the file. A PDF, a JPEG and a PNG must be detected as what they were
 * declared to be, with an extension that agrees. A DOCX and an XLSX are ZIP containers: the container must be a ZIP (an encrypted OOXML is an OLE container
 * and never agrees), the central directory must be readable ({@link inspectOoxml}), the kind recognised from its entries must be the declared one, and it
 * must carry NO macro (no VBA project, no macro sheet, no ActiveX, no macro-enabled content type). Everything that cannot be judged is a mismatch - the
 * file goes to quarantine as `type_mismatch` and never to `clean`.
 */
import {
  DOCX_TYPE,
  documentTypeAgrees,
  extensionMatches,
  isOoxml,
  normalizeDocumentType,
  type DocumentContentType,
} from './document-rules.ts';
import { inspectOoxml } from './ooxml-inspect.ts';

export interface DocumentFacts {
  /** The type the content declared at upload (a `DocumentContentType` normally). */
  readonly declaredType: string;
  readonly fileName: string | null;
  /** The type `file-type` detected in the first bytes (`undefined`: nothing recognised). */
  readonly detectedMime: string | undefined;
  readonly head: Uint8Array;
  readonly tail: Uint8Array;
  readonly size: number;
}

export interface DocumentVerdict {
  readonly typeMatches: boolean;
  /** The content type to store: the one the SERVER decided (the declared one when it agrees), else the detected one if it is on the list, else `null`. */
  readonly contentType: DocumentContentType | null;
}

const ZIP_MIME = 'application/zip';

export function judgeDocument(facts: DocumentFacts): DocumentVerdict {
  const declared = normalizeDocumentType(facts.declaredType);
  const detected = facts.detectedMime === undefined ? undefined : normalizeDocumentType(facts.detectedMime);
  if (declared === undefined) return { typeMatches: false, contentType: detected ?? null };
  if (!isOoxml(declared)) {
    return { typeMatches: documentTypeAgrees(facts.detectedMime, facts.declaredType, facts.fileName), contentType: detected ?? null };
  }
  const containerOk = facts.detectedMime === ZIP_MIME || detected === declared;
  const extensionOk = facts.fileName === null || extensionMatches(declared, facts.fileName);
  if (!containerOk || !extensionOk) return { typeMatches: false, contentType: detected ?? null };
  const inspection = inspectOoxml(facts.head, facts.tail, facts.size);
  const kindOk = inspection.ok && inspection.kind === (declared === DOCX_TYPE ? 'docx' : 'xlsx') && !inspection.macros;
  return kindOk ? { typeMatches: true, contentType: declared } : { typeMatches: false, contentType: detected ?? null };
}
