/**
 * The check of a chosen file before anything is sent (EVM-044 AC2, EVM-046 AC1; SR-FILE-01, SR-FILE-03): JPEG, PNG, WebP and HEIC up to
 * 50 MB, and films (MP4, MOV) up to 4 GiB. The check goes by the declared type and the extension; the server checks the CONTENT again after the upload (a `.jpg` with
 * other content ends in quarantine as `type_mismatch`), so this is a convenience, not a control.
 */
export const MAX_FILE_BYTES = 52_428_800;
/** A film: 4 GiB in bytes, exactly as the server counts it (the interface says "4 GB"). */
export const MAX_VIDEO_BYTES = 4_294_967_296;
/** The longest film (ADR-0009). */
export const MAX_VIDEO_SECONDS = 1800;
/** A film above this size gets the warning before it is sent over a mobile network (EVM-046 AC8; the browser cannot tell the network). */
export const LARGE_VIDEO_BYTES = 100_000_000;
/** The batch limit of the API (`maxItems`). */
export const MAX_BATCH = 50;

const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

const BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heif': 'image/heic',
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
};

/** True for the content types of films. */
export const isVideoType = (contentType: string): boolean => contentType.startsWith('video/');

export type FileCheck =
  { readonly ok: true; readonly contentType: string } | { readonly ok: false; readonly reason: 'format' | 'size' | 'empty' };

/** The content type the API accepts for a file (the extension decides when the browser gives none), or the reason to refuse it. */
export function checkFile(file: { readonly name: string; readonly type: string; readonly size: number }): FileCheck {
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const fromExtension = BY_EXTENSION[extension];
  const fromType = BY_TYPE[file.type.toLowerCase()];
  // SVG, HTML and archives have a type and an extension of their own: both must agree with the allowed list.
  if (fromExtension === undefined || (file.type !== '' && fromType === undefined)) return { ok: false, reason: 'format' };
  const contentType = fromType ?? fromExtension;
  // a film named .jpg (or a photo named .mp4) is not what it says: the server would quarantine it, the tab does not send it
  if (isVideoType(fromExtension) !== isVideoType(contentType)) return { ok: false, reason: 'format' };
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.size > (isVideoType(contentType) ? MAX_VIDEO_BYTES : MAX_FILE_BYTES)) return { ok: false, reason: 'size' };
  return { ok: true, contentType };
}

/**
 * The duration of a film from the metadata that the browser reads (EVM-046 AC1): a convenience that spares the person a long upload of a
 * film the server would refuse - the server measures the film again with ffprobe. `null` when the browser cannot read it (HEVC without a
 * decoder, a damaged file, no answer in time): then the film is sent and the server decides. The temporary `blob:` address lives for the read only.
 */
export function readVideoDuration(file: Blob, timeoutMs = 8000): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => {
      finish(null);
    }, timeoutMs);
    function finish(seconds: number | null): void {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(seconds);
    }
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      finish(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      finish(null);
    };
    video.src = url;
  });
}
