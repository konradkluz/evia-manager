/**
 * Who may get which address and which files can be downloaded (EVM-045; ADR-0009; P3, P6, P10; domain-model.md D6). Pure functions, no framework.
 *
 * - Three variants of a photo: `thumbnail` and `preview` (derivatives, shown inline) and `original` (may carry the location - P3; an attachment).
 * - The ORIGINAL is for Administrator and Editor only (P6, SR-AUTHZ-06): the contract admits Read-only to the operation, so the restriction of
 *   the variant lives here, in the service, and the matrix of roles forces the case "Read-only + original".
 * - The original is downloadable in `clean`, `ready` and `failed` with `processing_error` (the file PASSED the scan; the invariant of the model);
 *   never in any other state. Derivatives need `ready` and the row of the variant ({@link hasDerivatives}).
 * - The limits of issuing addresses (P10): two classes counted apart, derivatives (thumbnails and previews together) and originals.
 */
import type { UserRole } from '@evia/contracts';
import { extensionOf, normalizeContentType, type AllowedContentType } from './file-rules.ts';
import { URL_LIMITS, type UrlLimits, type VariantClass } from '../../../platform/signed-url-limits/signed-url-meters.ts';
import type { FileState, ReasonCode } from './scan-outcome.ts';

export { URL_LIMITS, type UrlLimits, type VariantClass };

export const DOWNLOAD_VARIANTS = ['thumbnail', 'preview', 'original'] as const;
export type DownloadVariant = (typeof DOWNLOAD_VARIANTS)[number];

export const variantClass = (variant: DownloadVariant): VariantClass => (variant === 'original' ? 'original' : 'derivative');

/** P6: Read-only gets the derivatives, never the original. */
export const mayRequest = (role: UserRole, variant: DownloadVariant): boolean => variant !== 'original' || role !== 'read_only';

/** The files whose original may be handed out: they passed the scan (`failed` with `processing_error` did too - the processor failed, not the scan). */
export function isOriginalDownloadable(state: FileState, reason: ReasonCode | null): boolean {
  return state === 'clean' || state === 'ready' || (state === 'failed' && reason === 'processing_error');
}

const EXTENSION_OF_TYPE: Readonly<Record<AllowedContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
const MAX_DOWNLOAD_NAME = 120;
/** Quotes, backslashes, separators of a path, `;`, `%`, controls and invisible format characters (bidi, zero width) are never part of the name that reaches the header; controls go too. */
const STRIPPED = /[\p{Cc}\p{Cf}"\\/;%]/gu;

/**
 * The name under which the browser saves the original. Built from the stored (already cleaned) name by removing what could break out of the header
 * or point into a path, cut to 120 code points keeping the extension; an empty result falls back to `media-<first 8 of the id>.<extension of the type
 * the SERVER detected>` (CWE-113, CWE-22).
 */
export function downloadFileName(storedName: string | null, mediaAssetId: string, contentType: string | null): string {
  const cleaned = (storedName ?? '')
    .replace(STRIPPED, '')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^\.+/, '');
  if (cleaned !== '') return cut(cleaned);
  const type = contentType === null ? undefined : normalizeContentType(contentType);
  return `media-${mediaAssetId.replace(/-/g, '').slice(0, 8)}.${type === undefined ? 'bin' : EXTENSION_OF_TYPE[type]}`;
}

function cut(name: string): string {
  const points = Array.from(name);
  if (points.length <= MAX_DOWNLOAD_NAME) return name;
  const extension = extensionOf(name);
  const tail = extension === '' || extension.length > 10 ? '' : `.${extension}`;
  return `${points
    .slice(0, MAX_DOWNLOAD_NAME - Array.from(tail).length)
    .join('')
    .trim()}${tail}`;
}
