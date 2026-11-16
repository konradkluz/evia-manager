// @ts-check
/**
 * Device and server steps of the video scenarios (EVM-110 AC1, AC4, AC5, AC8; security requirements 04, 08; ADR-0015). They follow the rules of device.mjs,
 * device-upload.mjs and device-camera.mjs: builders return arguments for adb with fixed text, every judgement reports counts and codes - never a path inside
 * the app, a file content or a coordinate - and an unexpected answer or a failed command is a failure, never a pass.
 *
 * - `network-metered` / `network-unmetered` (AC4, AC5, AC8): the network is switched for REAL, with `svc`: Wi-Fi off and mobile data on = the default network
 *   is the mobile one (the emulator reports it as a network WITH charges: no `NOT_METERED`); Wi-Fi on = the network without charges. The step does not sleep a fixed
 *   time: it polls `dumpsys connectivity` until the default network is validated and has the wanted kind (the switch takes about 12 s and 8 s). The runner
 *   puts Wi-Fi back at the end of EVERY scenario and in its `finally`, whatever happened.
 * - `video-no-audio-no-location:<n>` (AC1; SEC-110-04): the n films the camera recorded (small ones, read from the private folder of the app) are valid MP4 with a
 *   track of video and no track of sound (`soun`) and no location atom (`©xyz`, `loci`, `location`) although the emulator HAD a location (`camera-geo-fix`).
 *   The reader is proved on films with a sound track and a place in node:test. Without a back camera the step says "not performed".
 * - `video-gallery-baseline` / `video-gallery-unchanged` (AC1; SEC-110-08): the rows of the video table of MediaStore and the files in /sdcard/DCIM,
 *   /sdcard/Pictures and /sdcard/Movies are the same before and after - the film went nowhere but the private folder.
 * - `upload-part-puts:<n>` (AC4): the scenario server received exactly n parts in all (it waits for n, then a while longer: no part comes late) - the proof
 *   that a film held for Wi-Fi sent NOTHING over the network with charges while the picture went.
 * - `upload-part-puts-hold` (AC5): no part arrives during a while (the network with charges): the number of parts does not grow.
 */
import { APPLICATION_ID } from './commands.mjs';
import { readGallery } from './device-camera.mjs';
import { checkpointOf, pollUntil, UPLOAD_ROOT } from './device-upload.mjs';
import { judgeFilm } from './mp4.mjs';

const NEWLINE = /\r?\n/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest film read over adb as text (a recording of seconds is a few MB; the synthetic ones of 64 MiB are not read). */
export const READ_LIMIT_BYTES = 30 * 1024 * 1024;
/** The switch of the network takes about 12 s (to mobile) and 8 s (back to Wi-Fi); the limit is generous, the poll is short. */
export const NETWORK_WAIT_MS = 90_000;
/** How long the server is watched for a part that comes late (the answer to a part is held by `upload-part-delay`, the part itself is stored at once). */
export const QUIET_MS = 8000;
export const PARTS_WAIT_MS = 180_000;

/**
 * @typedef {'network-metered' | 'network-unmetered' | 'video-gallery-baseline' | 'video-gallery-unchanged' | 'upload-part-puts-hold' | 'video-last-error'
 *   | `video-no-audio-no-location:${string}` | `upload-part-puts:${string}`} VideoAction
 * @typedef {import('./device-upload.mjs').UploadContext} VideoContext
 * @typedef {import('./device-upload.mjs').Outcome} Outcome
 * @typedef {import('./device-upload.mjs').Judgement} Judgement
 */

export const VIDEO_ACTION_NAMES = new Set([
  'network-metered',
  'network-unmetered',
  'video-gallery-baseline',
  'video-gallery-unchanged',
  'video-no-audio-no-location',
  'upload-part-puts',
  'upload-part-puts-hold',
  'video-last-error',
]);

/** @param {string} action @returns {boolean} */
export function isVideoAction(action) {
  return VIDEO_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** Commands of the video steps (arguments of adb after `-s <serial>`). */
export const videoCommands = {
  /** @param {boolean} on */
  wifi: (on) => ['shell', 'svc', 'wifi', on ? 'enable' : 'disable'],
  /** Mobile data stays ON in both states: it is the network the phone is left with when Wi-Fi goes. */
  data: () => ['shell', 'svc', 'data', 'enable'],
  connectivity: () => ['shell', 'dumpsys', 'connectivity'],
  features: () => ['shell', 'pm', 'list', 'features'],
  /** The rows of the video table of MediaStore. */
  mediaVideos: () => ['shell', 'content', 'query', '--uri', 'content://media/external/video/media', '--projection', '_id'],
  /** The code the app wrote for the last film that was not saved (a hook of the e2e build only; a code, never a path). */
  lastFilmError: () => ['shell', `run-as ${APPLICATION_ID} cat files/e2e-last-film-error.txt`],
  galleryFolders: () => ['shell', 'ls', '-d', '/sdcard/DCIM'],
  galleryFiles: () => ['shell', 'find /sdcard/DCIM /sdcard/Pictures /sdcard/Movies -type f 2>/dev/null; true'],
  /** The originals with their sizes (the film is `<assetId>.mp4`). */
  listOriginals: () => ['shell', `run-as ${APPLICATION_ID} ls -l ${UPLOAD_ROOT}/originals`],
  /** @param {string} name `<assetId>.mp4` (checked) */
  readFilm: (name) => {
    if (!/^[0-9a-f-]{36}\.mp4$/.test(name) || !UUID.test(name.slice(0, 36))) throw new Error('not a film name');
    return ['shell', `run-as ${APPLICATION_ID} base64 ${UPLOAD_ROOT}/originals/${name}`];
  },
};

// ---- the network ------------------------------------------------------------------------------------------------------------------

/**
 * What `dumpsys connectivity` says about the DEFAULT network: its transport and whether it has charges. `null` = the text is not what the reader expects.
 * @param {string} text
 * @returns {{ transport: 'wifi' | 'cellular' | 'other', metered: boolean, validated: boolean } | null}
 */
export function defaultNetworkOf(text) {
  const id = /Active default network:\s*(\d+)/.exec(text)?.[1];
  if (id === undefined) return null;
  const line = text.split(NEWLINE).find((candidate) => candidate.includes(`network{${id}}`) && /Capabilities:/.test(candidate));
  if (line === undefined) return null;
  const transports = /Transports:\s*([A-Z_&|]+)/.exec(line)?.[1] ?? '';
  const capabilities = /Capabilities:\s*([A-Z_&|0-9]+)/.exec(line)?.[1] ?? '';
  return {
    transport: transports.includes('WIFI') ? 'wifi' : transports.includes('CELLULAR') ? 'cellular' : 'other',
    metered: !capabilities.includes('NOT_METERED'),
    validated: capabilities.includes('VALIDATED'),
  };
}

/**
 * @param {VideoContext} context
 * @param {boolean} metered `true` = the phone is left with the mobile network (with charges), `false` = Wi-Fi (without)
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function switchNetwork(context, metered) {
  const first = context.adb(...videoCommands.wifi(!metered));
  const second = context.adb(...videoCommands.data());
  if (first.status !== 0 || second.status !== 0) return { ok: false, detail: 'svc could not switch the network' };
  const wanted = (/** @type {ReturnType<typeof defaultNetworkOf>} */ now) =>
    now !== null && now.validated && now.metered === metered && now.transport === (metered ? 'cellular' : 'wifi');
  const read = () => defaultNetworkOf(context.adb(...videoCommands.connectivity()).stdout);
  const reached = await pollUntil(context, NETWORK_WAIT_MS, read, wanted);
  return wanted(reached)
    ? {
        ok: true,
        detail: metered
          ? 'the default network is mobile: validated, with charges (no NOT_METERED)'
          : 'the default network is Wi-Fi: validated, without charges',
      }
    : {
        ok: false,
        detail: `the default network did not become ${metered ? 'mobile with charges' : 'Wi-Fi'} in ${String(NETWORK_WAIT_MS / 1000)} s (${reached === null ? 'unreadable' : `${reached.transport}, ${reached.metered ? 'with' : 'without'} charges, ${reached.validated ? 'validated' : 'not validated'}`})`,
      };
}

// ---- the films on the device ------------------------------------------------------------------------------------------------------

/**
 * The names of the films (`<assetId>.mp4`) in the originals with their sizes, from `ls -l`.
 * @param {string} text
 * @returns {{ name: string, size: number }[]}
 */
export function filmsListed(text) {
  return text.split(NEWLINE).flatMap((line) => {
    const match = /^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+([0-9a-f-]{36}\.mp4)\s*$/.exec(line.trim());
    return match === null ? [] : [{ name: match[2] ?? '', size: Number(match[1]) }];
  });
}

/**
 * AC1: the films the camera recorded (those small enough to be read) carry no sound and no place.
 * @param {Record<string, Buffer>} films by name @param {number} expected
 * @returns {Judgement}
 */
export function judgeFilms(films, expected) {
  const judgements = Object.values(films).map((bytes) => judgeFilm(bytes));
  const judged = judgements.filter((one) => one.judged);
  const bad = judged.filter((one) => !one.ok);
  if (bad.length > 0)
    return { ok: false, detail: `${String(bad.length)} of ${String(judged.length)} film(s): ${bad.map((one) => one.detail).join(' | ')}` };
  if (judged.length < expected)
    return { ok: false, detail: `${String(judged.length)} film(s) with tracks to judge, ${String(expected)} expected` };
  return {
    ok: true,
    detail: `${String(judged.length)} film(s): a video track, no sound track (soun), no location atom (©xyz, loci, location)`,
  };
}

/** @param {VideoContext} context */
function galleryNow(context) {
  return readGallery(
    context.adb(...videoCommands.mediaVideos()),
    context.adb(...videoCommands.galleryFiles()),
    context.adb(...videoCommands.galleryFolders()),
  );
}

/**
 * @param {{ images: number, files: string[] }} before @param {{ images: number, files: string[] }} after
 * @returns {Judgement}
 */
export function judgeVideoGallery(before, after) {
  const same =
    before.images === after.images &&
    before.files.length === after.files.length &&
    before.files.every((name, index) => name === after.files[index]);
  const text = `MediaStore video rows ${String(before.images)} -> ${String(after.images)}; files in /sdcard/DCIM, /sdcard/Pictures and /sdcard/Movies ${String(before.files.length)} -> ${String(after.files.length)}`;
  return same ? { ok: true, detail: `${text}: unchanged` } : { ok: false, detail: `${text}: CHANGED (a film reached the public gallery?)` };
}

/**
 * Runs one video step and judges it.
 * @param {string} action the action name, with its value after a colon
 * @param {VideoContext} context
 * @returns {Promise<{ action: string, ok: boolean, detail: string, skipped?: boolean }>}
 */
export async function runVideoAction(action, context) {
  const [name = '', first] = action.split(':');
  /** @param {boolean} ok @param {string} detail */
  const check = (ok, detail) => ({ action, ok, detail });
  /** @param {string | undefined} text */
  const whole = (text) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : null);

  switch (name) {
    case 'network-metered':
    case 'network-unmetered': {
      const done = await switchNetwork(context, name === 'network-metered');
      return check(done.ok, done.detail);
    }
    case 'video-gallery-baseline': {
      const gallery = galleryNow(context);
      if (gallery === null || context.memory === undefined)
        return check(false, 'the gallery (MediaStore videos, /sdcard/DCIM, Pictures, Movies) could not be read');
      context.memory.set('video-gallery', gallery);
      return check(
        true,
        `baseline: ${String(gallery.images)} video row(s) in MediaStore, ${String(gallery.files.length)} file(s) in the public folders`,
      );
    }
    case 'video-gallery-unchanged': {
      const before = /** @type {{ images: number, files: string[] } | undefined} */ (context.memory?.get('video-gallery'));
      if (before === undefined) return check(false, 'no baseline of the video gallery (the step video-gallery-baseline did not run)');
      const after = galleryNow(context);
      if (after === null) return check(false, 'the gallery could not be read');
      const judged = judgeVideoGallery(before, after);
      return check(judged.ok, judged.detail);
    }
    case 'video-last-error': {
      const answer = context.adb(...videoCommands.lastFilmError());
      const code = answer.stdout.trim();
      if (answer.status !== 0 || !/^[a-z0-9_]{1,60}$/.test(code)) return check(true, 'no code of a failed film was left by the app');
      return check(true, `the app reports the last failed film as: ${code}`);
    }
    case 'video-no-audio-no-location': {
      const expected = whole(first);
      if (expected === null || expected === 0)
        return check(false, 'video-no-audio-no-location needs the number of films (video-no-audio-no-location:1)');
      // without a back camera the check proves nothing about the camera: it FAILS (a green step that checked nothing is worse than a red one)
      if (!/android\.hardware\.camera\b/.test(context.adb(...videoCommands.features()).stdout))
        return check(
          false,
          'NOT PERFORMED: the emulator reports no back camera (android.hardware.camera); a synthetic film has no moov and proves nothing about the camera',
        );
      const listing = context.adb(...videoCommands.listOriginals());
      if (listing.status !== 0) return check(false, 'the originals of the app could not be listed');
      /** @type {Record<string, Buffer>} */
      const films = {};
      for (const film of filmsListed(listing.stdout)) {
        if (film.size > READ_LIMIT_BYTES) continue;
        const answer = context.adb(...videoCommands.readFilm(film.name));
        if (answer.status !== 0) return check(false, 'a film of the app could not be read');
        films[film.name] = Buffer.from(answer.stdout.replaceAll(/\s+/g, ''), 'base64');
      }
      const judged = judgeFilms(films, expected);
      return { action, ok: judged.ok, detail: judged.detail };
    }
    case 'upload-part-puts': {
      const expected = whole(first);
      if (expected === null) return check(false, 'upload-part-puts needs the number of parts (upload-part-puts:1)');
      const count = (/** @type {import('./device-upload.mjs').Checkpoint | null} */ point) => point?.counters['partPuts'] ?? -1;
      const reached = await pollUntil(
        context,
        expected === 0 ? 0 : PARTS_WAIT_MS,
        () => checkpointOf(context),
        (point) => count(point) >= expected,
      );
      if (count(reached) < expected)
        return check(false, `the server received ${String(count(reached))} part(s), at least ${String(expected)} expected`);
      await context.sleep(QUIET_MS);
      const after = count(await checkpointOf(context));
      return check(
        after === expected,
        `the server received ${String(after)} part(s) in all (expected exactly ${String(expected)}; a late part is a failure)`,
      );
    }
    case 'upload-part-puts-hold': {
      const read = async () => (await checkpointOf(context))?.counters['partPuts'] ?? -1;
      const before = await read();
      await context.sleep(QUIET_MS);
      const after = await read();
      return check(
        before >= 0 && after === before,
        `parts received ${String(before)} -> ${String(after)} while the phone is on the network with charges (no new part expected)`,
      );
    }
    default:
      return check(false, 'unknown video step');
  }
}
