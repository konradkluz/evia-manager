// @ts-check
/**
 * Device and server steps of the camera scenarios (EVM-108 AC1, AC3, AC5, AC7; security requirements 20 and 21; ADR-0015). They follow the
 * rules of device.mjs and device-upload.mjs: builders return arguments for adb with fixed text (the only value that goes into a shell string
 * is an asset id checked against the UUID pattern), every judgement reports counts and codes — never a path inside the app, a file content
 * or a coordinate — and an unexpected answer or a failed command is a failure, never a pass.
 *
 * What the steps prove:
 * - `original-exif-clean:<n>` (AC1): the n originals the camera left in the private folder of the app carry no GPS — in the APP1 / EXIF
 *   segment no pointer to the GPS IFD (tag 0x8825) in any IFD, in the APP1 / XMP packet no `exif:GPS`. The emulator is given a location
 *   first (`camera-geo-fix`), so a camera that WOULD write one has something to write. The reader is proved on a JPEG with a GPS IFD in
 *   node:test (the positive control): a reader that finds nothing anywhere would pass every file. Without a back camera the step says
 *   "not performed" (`skipped`), never "ok": a synthetic file of the hook has no EXIF at all and proves nothing about the camera.
 * - `gallery-baseline` / `gallery-unchanged` (AC1): the number of image rows of MediaStore and the files in /sdcard/DCIM and
 *   /sdcard/Pictures are the same before and after the shots — the photograph went nowhere but the private folder.
 * - `permissions-minimal` (AC1, AC3): `dumpsys package` lists no location, microphone or storage permission for the app.
 * - `upload-checkpoint-many:<n>` (AC7): n objects at the scenario server, one per asset, all in the right work order, SHA-256 equal to the
 *   original on the device, no two alike (no duplicate), no orphaned multipart.
 */
import { APPLICATION_ID } from './commands.mjs';
import { CHECKPOINT_WAIT_MS, checkpointOf, judgeCheckpoint, originalsOnDevice, pollUntil, UPLOAD_ROOT } from './device-upload.mjs';

/** The work order of the synthetic files of the e2e variant (apps/mobile/src/e2e-hooks/panel.tsx E2E_MEDIA_WORK_ORDER): the order ZL-E2E-1 of the scenario server. */
export const E2E_MEDIA_WORK_ORDER = '30000000-0000-4000-8000-000000000001';
export const CAMERA_PERMISSION = 'android.permission.CAMERA';
/** A synthetic place for `adb emu geo fix <longitude> <latitude>` (the centre of a city; no real person is there). */
export const GEO_FIX = { longitude: '21.0122', latitude: '52.2297' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NEWLINE = /\r?\n/;

/**
 * @typedef {'camera-grant' | 'camera-revoke' | 'camera-geo-fix' | 'gallery-baseline' | 'gallery-unchanged' | 'permissions-minimal'
 *   | `original-exif-clean:${string}` | `upload-checkpoint-many:${string}`} CameraAction
 * @typedef {import('./device-upload.mjs').UploadContext} CameraContext
 * @typedef {import('./device-upload.mjs').Outcome} Outcome
 * @typedef {import('./device-upload.mjs').Judgement} Judgement
 */

export const CAMERA_ACTION_NAMES = new Set([
  'camera-grant',
  'camera-revoke',
  'camera-geo-fix',
  'gallery-baseline',
  'gallery-unchanged',
  'permissions-minimal',
  'original-exif-clean',
  'upload-checkpoint-many',
]);

/** @param {string} action @returns {boolean} */
export function isCameraAction(action) {
  return CAMERA_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** @param {string} assetId */
function checkedAssetId(assetId) {
  if (!UUID.test(assetId)) throw new Error('not an asset id');
  return assetId;
}

/** Commands of the camera steps (arguments of adb after `-s <serial>`). */
export const cameraCommands = {
  /** @param {boolean} on */
  permission: (on) => ['shell', 'pm', on ? 'grant' : 'revoke', APPLICATION_ID, CAMERA_PERMISSION],
  geoFix: () => ['emu', 'geo', 'fix', GEO_FIX.longitude, GEO_FIX.latitude],
  /** The features of the device: `android.hardware.camera` is the back camera (the AVD has `hw.camera.back` other than none). */
  features: () => ['shell', 'pm', 'list', 'features'],
  /** The rows of the image table of MediaStore (the shell may read it; the app has no permission to write there). */
  mediaImages: () => ['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id'],
  /** The folders of the public gallery: a missing folder is an error of the step (the proof would be empty). */
  galleryFolders: () => ['shell', 'ls', '-d', '/sdcard/DCIM', '/sdcard/Pictures'],
  galleryFiles: () => ['shell', 'find /sdcard/DCIM /sdcard/Pictures -type f 2>/dev/null; true'],
  dumpsysPackage: () => ['shell', 'dumpsys', 'package', APPLICATION_ID],
  listOriginals: () => ['shell', `run-as ${APPLICATION_ID} ls ${UPLOAD_ROOT}/originals`],
  /** The original as base64 text: binary output never passes through a text decoder. @param {string} assetId a UUID (checked) */
  readOriginal: (assetId) => ['shell', `run-as ${APPLICATION_ID} base64 ${UPLOAD_ROOT}/originals/${checkedAssetId(assetId)}`],
};

// ---- the reader of a JPEG: APP1 / EXIF and APP1 / XMP -----------------------------------------------------------------------------

const EXIF_HEADER = 'Exif\0\0';
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const TAG_GPS_IFD = 0x88_25;
const TAG_EXIF_IFD = 0x87_69;
const TAG_INTEROP_IFD = 0xa0_05;

/**
 * Looks for a pointer to the GPS IFD in the TIFF structure of an EXIF segment: in IFD0, in the IFDs reached from it (the next one and the
 * EXIF and interoperability sub-IFDs). A structure that does not parse is `null` (fail closed: the caller cannot call it clean).
 * @param {Buffer} tiff
 * @returns {boolean | null} true = a GPS IFD pointer is there
 */
export function tiffHasGpsPointer(tiff) {
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  /** @param {number} at */
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  /** @param {number} at */
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  /** @type {Set<number>} */
  const seen = new Set();
  let gps = false;
  /** @param {number} offset @param {number} depth */
  const walk = (offset, depth) => {
    if (offset === 0 || seen.has(offset) || depth > 6) return;
    seen.add(offset);
    const count = u16(offset);
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      const tag = u16(entry);
      if (tag === TAG_GPS_IFD) gps = true;
      if (tag === TAG_EXIF_IFD || tag === TAG_INTEROP_IFD) walk(u32(entry + 8), depth + 1);
    }
    walk(u32(offset + 2 + count * 12), depth + 1);
  };
  try {
    walk(u32(4), 0);
  } catch {
    return null;
  }
  return gps;
}

/**
 * Reads the marker segments of a JPEG up to the start of the scan and reports what the metadata says about a location.
 * @param {Buffer} bytes
 * @returns {{ valid: boolean, exifSegments: number, xmpSegments: number, gpsPointer: boolean, xmpGps: boolean }}
 */
export function inspectJpeg(bytes) {
  const result = { valid: false, exifSegments: 0, xmpSegments: 0, gpsPointer: false, xmpGps: false };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return result;
  let at = 2;
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return result;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return { ...result, valid: true };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // markers without a length
      continue;
    }
    if (at + 4 > bytes.length) return result;
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return result;
    if (marker === 0xe1) {
      const payload = bytes.subarray(at + 4, at + 2 + length);
      if (payload.toString('latin1', 0, EXIF_HEADER.length) === EXIF_HEADER) {
        result.exifSegments += 1;
        const gps = tiffHasGpsPointer(payload.subarray(EXIF_HEADER.length));
        if (gps === null) return result; // an EXIF structure that cannot be read is not clean
        if (gps) result.gpsPointer = true;
      } else if (payload.toString('latin1', 0, XMP_HEADER.length) === XMP_HEADER) {
        result.xmpSegments += 1;
        if (/exif:GPS/i.test(payload.toString('latin1'))) result.xmpGps = true;
      }
    }
    at += 2 + length;
  }
  return result;
}

/**
 * AC1: no original carries a GPS pointer or GPS in XMP; there are exactly `expected` originals and every one is a readable JPEG.
 * @param {Record<string, Buffer | null>} originals asset id -> the bytes (`null` = unreadable)
 * @param {number} expected
 * @returns {Judgement}
 */
export function judgeOriginalsExif(originals, expected) {
  const entries = Object.entries(originals);
  if (entries.length !== expected)
    return { ok: false, detail: `${String(entries.length)} original(s) on the device, ${String(expected)} expected` };
  let unreadable = 0;
  let withExif = 0;
  let gps = 0;
  let xmpGps = 0;
  for (const [, bytes] of entries) {
    const found = bytes === null ? null : inspectJpeg(bytes);
    if (found === null || !found.valid) {
      unreadable += 1;
      continue;
    }
    if (found.exifSegments > 0) withExif += 1;
    if (found.gpsPointer) gps += 1;
    if (found.xmpGps) xmpGps += 1;
  }
  const clean = unreadable === 0 && gps === 0 && xmpGps === 0;
  const text = `${String(entries.length)} original(s): ${String(withExif)} with an EXIF segment, ${String(gps)} with a GPS IFD pointer, ${String(xmpGps)} with exif:GPS in XMP, ${String(unreadable)} unreadable`;
  return clean ? { ok: true, detail: `${text} — no location in any original` } : { ok: false, detail: text };
}

/**
 * Is there a back camera? (`pm list features` names `android.hardware.camera` only for a device that has one.)
 * @param {Outcome} features
 * @returns {boolean}
 */
export function hasBackCamera(features) {
  return features.status === 0 && /^feature:android\.hardware\.camera(?:\s|$)/m.test(features.stdout);
}

// ---- the gallery ------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ images: number, files: string[] }} Gallery
 * @param {Outcome} images `content query` over the image table
 * @param {Outcome} files `find` over the public folders
 * @param {Outcome} folders `ls -d` of the two folders
 * @returns {Gallery | null} `null` = the state cannot be read (the proof would be empty)
 */
export function readGallery(images, files, folders) {
  if (images.status !== 0 || files.status !== 0 || folders.status !== 0) return null;
  const rows = images.stdout.split(NEWLINE).filter((line) => /^Row:\s*\d+/.test(line.trim())).length;
  // no `Row:` line and no "No result found." means the answer was not what a query prints
  if (rows === 0 && !/no result found/i.test(images.stdout)) return null;
  return {
    images: rows,
    files: files.stdout
      .split(NEWLINE)
      .filter((line) => line.trim() !== '')
      .sort(),
  };
}

/**
 * AC1: nothing was added to the public gallery between the baseline and now (counts only, no file names).
 * @param {Gallery} before @param {Gallery} after
 * @returns {Judgement}
 */
export function judgeGallery(before, after) {
  const same =
    before.images === after.images &&
    before.files.length === after.files.length &&
    before.files.every((name, index) => name === after.files[index]);
  const text = `MediaStore image rows ${String(before.images)} -> ${String(after.images)}; files in /sdcard/DCIM and /sdcard/Pictures ${String(before.files.length)} -> ${String(after.files.length)}`;
  return same
    ? { ok: true, detail: `${text}: unchanged` }
    : { ok: false, detail: `${text}: CHANGED (a photograph reached the public gallery?)` };
}

// ---- the permissions --------------------------------------------------------------------------------------------------------------

/** The permissions the app must never hold (AC1: no location; AC3: no microphone, no storage). */
export const FORBIDDEN_PERMISSION =
  /android\.permission\.(?:ACCESS_(?:FINE|COARSE|BACKGROUND|MEDIA)_LOCATION|RECORD_AUDIO|READ_MEDIA_\w+|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)/;

/**
 * @param {Outcome} dump `dumpsys package <app>`
 * @returns {Judgement}
 */
export function judgePermissions(dump) {
  if (dump.status !== 0) return { ok: false, detail: `dumpsys package failed (exit ${String(dump.status)})` };
  if (!dump.stdout.includes(`Package [${APPLICATION_ID}]`))
    return { ok: false, detail: 'dumpsys package did not describe the app (the proof would be empty)' };
  const names = new Set(dump.stdout.split(NEWLINE).flatMap((line) => FORBIDDEN_PERMISSION.exec(line)?.[0] ?? []));
  return names.size === 0
    ? { ok: true, detail: 'the app requests no location, microphone or storage permission' }
    : { ok: false, detail: `${String(names.size)} forbidden permission(s) requested or granted: ${[...names].sort().join(', ')}` };
}

// ---- the batch checkpoint ---------------------------------------------------------------------------------------------------------

/**
 * AC7: exactly `expected` objects in the right work order, one per asset, equal to the originals, none alike, nothing orphaned.
 * @param {import('./device-upload.mjs').Checkpoint} point
 * @param {Record<string, string | null>} originals asset id -> SHA-256 of the original on the device (`null` = none there)
 * @param {number} expected
 * @param {string} workOrderId
 * @returns {Judgement}
 */
export function judgeBatch(point, originals, expected, workOrderId) {
  const entries = Object.entries(point.assets);
  const problems = [];
  if (entries.length !== expected) problems.push(`${String(entries.length)} asset(s) at the server, ${String(expected)} expected`);
  const elsewhere = entries.filter(([, asset]) => asset.workOrderId !== workOrderId).length;
  if (elsewhere > 0) problems.push(`${String(elsewhere)} asset(s) in another work order`);
  const objects = entries.reduce((sum, [, asset]) => sum + asset.objects, 0);
  if (objects !== expected) problems.push(`${String(objects)} object(s) at the server, ${String(expected)} expected`);
  const digests = entries.flatMap(([, asset]) => asset.sha256 ?? []);
  if (new Set(digests).size !== digests.length)
    problems.push(`${String(digests.length - new Set(digests).size)} object(s) with the SHA-256 of another one (a duplicate)`);
  // one object per asset, equal to the original, no orphaned or open multipart (the part of the single-file judgement that does not depend on the count)
  const general = judgeCheckpoint(point, originals, Number.POSITIVE_INFINITY);
  if (!general.ok) problems.push(general.detail);
  return problems.length === 0
    ? {
        ok: true,
        detail: `${String(expected)} object(s) in the right work order, one per asset, SHA-256 equal to the original, 0 duplicates, 0 orphaned multiparts (${String(point.counters['partsReplaced'] ?? 0)} part(s) sent again)`,
      }
    : { ok: false, detail: problems.join('; ') };
}

// ---- the steps --------------------------------------------------------------------------------------------------------------------

/**
 * @param {CameraContext} context
 * @param {string} key
 * @returns {Gallery | null}
 */
function baselineOf(context, key) {
  const kept = context.memory?.get(key);
  return kept === undefined ? null : /** @type {Gallery} */ (kept);
}

/** @param {CameraContext} context @returns {Gallery | null} */
function galleryNow(context) {
  return readGallery(
    context.adb(...cameraCommands.mediaImages()),
    context.adb(...cameraCommands.galleryFiles()),
    context.adb(...cameraCommands.galleryFolders()),
  );
}

/**
 * The originals of the app as bytes (`null` = unreadable); the list comes from the folder of the module.
 * @param {CameraContext} context
 * @returns {Record<string, Buffer | null> | null} `null` = the folder could not be listed
 */
function originalsAsBytes(context) {
  const listing = context.adb(...cameraCommands.listOriginals());
  if (listing.status !== 0) return null;
  /** @type {Record<string, Buffer | null>} */
  const bytes = {};
  for (const name of listing.stdout.split(NEWLINE).map((line) => line.trim())) {
    if (!UUID.test(name)) continue;
    const answer = context.adb(...cameraCommands.readOriginal(name));
    bytes[name] = answer.status === 0 ? Buffer.from(answer.stdout.replaceAll(/\s+/g, ''), 'base64') : null;
  }
  return bytes;
}

/**
 * Runs one camera step and judges it.
 * @param {string} action the action name, with its value after a colon
 * @param {CameraContext} context
 * @returns {Promise<{ action: string, ok: boolean, detail: string, skipped?: boolean }>}
 */
export async function runCameraAction(action, context) {
  const [name = '', first] = action.split(':');
  /** @param {boolean} ok @param {string} detail */
  const check = (ok, detail) => ({ action, ok, detail });
  /** @param {Judgement} judged */
  const judged = (judged) => ({ action, ok: judged.ok, detail: judged.detail, ...(judged.skipped === true ? { skipped: true } : {}) });
  /** @param {string | undefined} text */
  const whole = (text) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : null);

  switch (name) {
    case 'camera-grant':
    case 'camera-revoke':
      return check(
        context.adb(...cameraCommands.permission(name === 'camera-grant')).status === 0,
        name === 'camera-grant' ? 'permission for the camera granted' : 'permission for the camera revoked',
      );
    case 'camera-geo-fix': {
      const answer = context.adb(...cameraCommands.geoFix());
      return check(
        answer.status === 0 && !/\bKO\b/.test(answer.stdout),
        'the emulator has a (synthetic) location, so a camera that writes one has something to write',
      );
    }
    case 'gallery-baseline': {
      const gallery = galleryNow(context);
      if (gallery === null || context.memory === undefined)
        return check(false, 'the gallery (MediaStore, /sdcard/DCIM, /sdcard/Pictures) could not be read');
      context.memory.set('gallery', gallery);
      return check(
        true,
        `baseline: ${String(gallery.images)} image row(s) in MediaStore, ${String(gallery.files.length)} file(s) in /sdcard/DCIM and /sdcard/Pictures`,
      );
    }
    case 'gallery-unchanged': {
      const before = baselineOf(context, 'gallery');
      if (before === null) return check(false, 'no baseline of the gallery (the step gallery-baseline did not run)');
      const after = galleryNow(context);
      return after === null ? check(false, 'the gallery could not be read') : judged(judgeGallery(before, after));
    }
    case 'permissions-minimal':
      return judged(judgePermissions(context.adb(...cameraCommands.dumpsysPackage())));
    case 'original-exif-clean': {
      const expected = whole(first);
      if (expected === null) return check(false, 'original-exif-clean needs the number of originals (original-exif-clean:2)');
      if (!hasBackCamera(context.adb(...cameraCommands.features())))
        return {
          action,
          ok: true,
          skipped: true,
          detail:
            'NOT PERFORMED: the emulator reports no back camera (android.hardware.camera). A synthetic file of the hook has no EXIF at all, so nothing about the camera was proved; use an AVD with hw.camera.back=virtualscene',
        };
      const bytes = originalsAsBytes(context);
      return bytes === null ? check(false, 'the originals of the app could not be listed') : judged(judgeOriginalsExif(bytes, expected));
    }
    case 'upload-checkpoint-many': {
      const expected = whole(first);
      if (expected === null || expected === 0)
        return check(false, 'upload-checkpoint-many needs the number of objects (upload-checkpoint-many:30)');
      const done = (/** @type {import('./device-upload.mjs').Checkpoint | null} */ read) =>
        read !== null && Object.keys(read.assets).length >= expected && Object.values(read.assets).every((asset) => asset.objects === 1);
      const point = await pollUntil(context, CHECKPOINT_WAIT_MS, () => checkpointOf(context), done);
      if (point === null) return check(false, 'the checkpoint could not be read');
      return judged(judgeBatch(point, originalsOnDevice(context, Object.keys(point.assets)), expected, E2E_MEDIA_WORK_ORDER));
    }
    default:
      return check(false, 'unknown camera step');
  }
}
