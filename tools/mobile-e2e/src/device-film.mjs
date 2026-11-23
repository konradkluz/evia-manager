// @ts-check
/**
 * Device and server steps of the film scenarios (EVM-143 AC3-AC6; flows 144-148 of apps/mobile/e2e; ADR-0015). Like the proof of EVM-142 the proof of AC5 is "nothing of a film
 * stays on the phone and nothing of an address is logged", and an empty search proves nothing, so it has the same shape:
 *
 * - a BASELINE of the install before any film was played (`film-disk-baseline`: the files whose CONTENT holds `ftyp` - the box every MP4 starts with - or the marker `E2EMARK` of
 *   the signed addresses, the files NAMED `*.mp4`, `*.exo`, `*.m4s` (the cache files of the player), in `/data/data/<package>` (through `run-as`) and `/sdcard/Android/data/<package>`,
 *   and the entries of `cache/http-cache`; the log buffer is made big and cleared);
 * - the CHECKS after the screens were used (`film-disk-check`: nothing beyond the baseline; `photos-logcat-clean` of EVM-142: no address of the bucket, no `X-Amz-Signature`, no
 *   `E2EMARK` in the log; `film-headers`: the requests for the film carried no `Authorization`, no `Cookie` and no `_=`, and there were some);
 * - the POSITIVE CONTROL of the search (`film-disk-control`): the step plants a file `cache/E2E-control.mp4` with `ftyp` and the marker in the app directory and the very SAME
 *   search MUST find it by content and by name (a search that finds nothing proves nothing); the file is removed again.
 *
 * Judgements report counts and codes - never a path, a content or an address.
 * @typedef {'film-fixture' | `film-throttle:${string}` | `film-expire:${string}` | `film-requests:${string}` | 'film-headers' | 'film-manifest' | 'film-disk-baseline' | 'film-disk-check' | 'film-disk-control'} FilmAction
 * @typedef {import('./device-upload.mjs').UploadContext} FilmContext
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ ok: boolean, detail: string }} Judgement
 */
import { APPLICATION_ID } from './commands.mjs';
import { cameraCommands } from './device-camera.mjs';
import { ADDRESS_MARK, cacheEntries, classifyCache, judgeRequests, matchedFiles, photosCommands } from './device-photos.mjs';

export const FILM_ACTION_NAMES = new Set([
  'film-fixture',
  'film-throttle',
  'film-expire',
  'film-requests',
  'film-headers',
  'film-manifest',
  'film-disk-baseline',
  'film-disk-check',
  'film-disk-control',
]);

/** @param {string} action @returns {boolean} */
export function isFilmAction(action) {
  return FILM_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** The box that every MP4 starts with (`....ftypisom`); a cache of a player keeps the bytes of the film. */
export const MP4_SIGNATURE = 'ftyp';
const INTERNAL = `/data/data/${APPLICATION_ID}`;
const EXTERNAL = `/sdcard/Android/data/${APPLICATION_ID}`;
const CONTROL_FILE = 'cache/E2E-control.mp4';
const LOG_BUFFER = '16M';
const NEWLINE = /\r?\n/;
const REQUEST_POLLS = 20;
const PAUSE_MS = 1000;
/** The names of the files a player keeps its cache in (ExoPlayer: `*.exo`, `*.v3.exo`; plus the film files). */
const NAME_FILTER = "-iname '*.mp4' -o -iname '*.exo' -o -iname '*.m4s' -o -iname '*.webm'";

/** Commands of the film steps (arguments of adb after `-s <serial>`). */
export const filmCommands = {
  /** @param {string} pattern */
  grepInternal: (pattern) => ['shell', `run-as ${APPLICATION_ID} grep -r -l -a ${pattern} ${INTERNAL}`],
  /** @param {string} pattern */
  grepExternal: (pattern) => ['shell', `grep -r -l -a ${pattern} ${EXTERNAL}`],
  findInternal: () => ['shell', `run-as ${APPLICATION_ID} find ${INTERNAL} ${NAME_FILTER}`],
  findExternal: () => ['shell', `find ${EXTERNAL} ${NAME_FILTER}`],
  externalExists: () => ['shell', `ls -d ${EXTERNAL}`],
  plantControl: () => ['shell', `run-as ${APPLICATION_ID} sh -c "printf 'xxxxftypisom ${ADDRESS_MARK}-FILM' > ${CONTROL_FILE}"`],
  removeControl: () => ['shell', `run-as ${APPLICATION_ID} rm -f ${CONTROL_FILE}`],
};

/**
 * @typedef {{ container: Set<string>, mark: Set<string>, names: Set<string>, externalContainer: Set<string>, externalMark: Set<string>, externalNames: Set<string>, cache: { missing: boolean, names: string[] } }} FilmSnapshot
 * What the app directories hold: the files whose contents have an MP4 box or the marker of an address, the files named like a film or a cache of a player, and the HTTP cache.
 * @param {(...args: string[]) => Outcome} adb
 * @returns {FilmSnapshot | null} `null` = a search failed (the step fails: a search that could not run proves nothing)
 */
export function takeFilmSnapshot(adb) {
  const container = matchedFiles(adb(...filmCommands.grepInternal(MP4_SIGNATURE)));
  const mark = matchedFiles(adb(...filmCommands.grepInternal(ADDRESS_MARK)));
  const names = matchedFiles(adb(...filmCommands.findInternal()));
  const cache = cacheEntries(adb(...photosCommands.listCache()));
  const hasExternal = adb(...filmCommands.externalExists()).status === 0;
  /** @type {Set<string> | null} */
  const externalContainer = hasExternal ? matchedFiles(adb(...filmCommands.grepExternal(MP4_SIGNATURE))) : new Set();
  /** @type {Set<string> | null} */
  const externalMark = hasExternal ? matchedFiles(adb(...filmCommands.grepExternal(ADDRESS_MARK))) : new Set();
  /** @type {Set<string> | null} */
  const externalNames = hasExternal ? matchedFiles(adb(...filmCommands.findExternal())) : new Set();
  if (
    container === null ||
    mark === null ||
    names === null ||
    cache === null ||
    externalContainer === null ||
    externalMark === null ||
    externalNames === null
  )
    return null;
  return { container, mark, names, externalContainer, externalMark, externalNames, cache };
}

/** @param {Set<string>} now @param {Set<string>} before @returns {number} the files that were not in the baseline */
const added = (now, before) => [...now].filter((file) => !before.has(file)).length;

/**
 * @param {FilmSnapshot} baseline @param {FilmSnapshot} now
 * @returns {{ container: number, mark: number, names: number, external: number, cache: ReturnType<typeof classifyCache>, summary: string }}
 */
function difference(baseline, now) {
  const container = added(now.container, baseline.container);
  const mark = added(now.mark, baseline.mark);
  const names = added(now.names, baseline.names);
  const external =
    added(now.externalContainer, baseline.externalContainer) +
    added(now.externalMark, baseline.externalMark) +
    added(now.externalNames, baseline.externalNames);
  const cache = classifyCache(now.cache.names);
  const summary = `ftyp in ${String(container)} file(s) beyond the baseline (${String(baseline.container.size)} before), E2EMARK in ${String(mark)} (${String(baseline.mark.size)} before), film/cache names ${String(names)} (${String(baseline.names.size)} before), external ${String(external)}; http-cache: ${now.cache.missing ? 'no directory' : `${String(cache.journal)} journal file(s), ${String(cache.entries)} entry file(s), ${String(cache.other)} other`}`;
  return { container, mark, names, external, cache, summary };
}

/**
 * The negative judgement of AC5: nothing beyond the baseline holds a film, an address or looks like a cache of a player, and the HTTP cache holds its journal only.
 * @param {FilmSnapshot} baseline @param {FilmSnapshot} now @returns {Judgement}
 */
export function judgeFilmDisk(baseline, now) {
  const diff = difference(baseline, now);
  const clean =
    diff.container === 0 &&
    diff.mark === 0 &&
    diff.names === 0 &&
    diff.external === 0 &&
    diff.cache.entries === 0 &&
    diff.cache.other === 0;
  return { ok: clean, detail: clean ? `no trace: ${diff.summary}` : `TRACE ON THE DISK: ${diff.summary}` };
}

/**
 * The positive control: the planted file MUST be found by content (`ftyp`, the marker) and by name (`*.mp4`).
 * @param {FilmSnapshot} baseline @param {FilmSnapshot} now @returns {Judgement}
 */
export function judgeFilmControl(baseline, now) {
  const diff = difference(baseline, now);
  const found = diff.container >= 1 && diff.mark >= 1 && diff.names >= 1;
  return found
    ? { ok: true, detail: `positive control found the planted file: ${diff.summary}` }
    : { ok: false, detail: `POSITIVE CONTROL FOUND NOTHING (the search is blind, the proof is void): ${diff.summary}` };
}

/** The counters of the report of the photos part that concern the film. @typedef {{ urls: Record<string, number>, film: Record<string, number>, videoLoaded: boolean }} FilmReport */

/** @param {FilmReport} report @returns {Record<string, number>} the counters by the names the steps use */
export function filmCounters(report) {
  const film = report.film;
  return {
    urls: report.urls['videoPreview'] ?? 0,
    requests: film['requests'] ?? 0,
    ranges: film['ranges'] ?? 0,
    ok: film['ok'] ?? 0,
    failed: film['failed'] ?? 0,
    abandoned: film['abandoned'] ?? 0,
    bytes: film['bytes'] ?? 0,
  };
}

/** What the player must not bring into the merged manifest (AC6): a foreground service, the microphone, the fullscreen activity, a playback or media session service. */
export const FORBIDDEN_FILM_ENTRY =
  /android\.permission\.(?:FOREGROUND_SERVICE\w*|RECORD_AUDIO)|FullscreenPlayerActivity|PlaybackService|MediaSessionService|MediaButtonReceiver|MediaBrowserService/;

/**
 * AC6: the manifest as the system merged it holds no foreground service, no microphone and no component of a player that plays in the background.
 * @param {Outcome} dump `dumpsys package <app>` @returns {Judgement}
 */
export function judgeFilmManifest(dump) {
  if (dump.status !== 0) return { ok: false, detail: `dumpsys package failed (exit ${String(dump.status)})` };
  if (!dump.stdout.includes(`Package [${APPLICATION_ID}]`))
    return { ok: false, detail: 'dumpsys package did not describe the app (the proof would be empty)' };
  const found = new Set(dump.stdout.split(NEWLINE).flatMap((line) => FORBIDDEN_FILM_ENTRY.exec(line)?.[0] ?? []));
  return found.size === 0
    ? {
        ok: true,
        detail: 'the merged manifest has no foreground service, no RECORD_AUDIO, no fullscreen activity, no playback service',
      }
    : { ok: false, detail: `${String(found.size)} forbidden entr(y/ies) in the merged manifest: ${[...found].sort().join(', ')}` };
}

/**
 * AC3 AC5: the requests for the film carried no `Authorization`, no `Cookie`, no `_=` in the address, went to known addresses, and there were some (an empty proof is not a pass).
 * @param {FilmReport} report @returns {Judgement}
 */
export function judgeFilmHeaders(report) {
  const film = report.film;
  const requests = film['requests'] ?? 0;
  const bad = [
    ['with Authorization', film['authorization'] ?? 0],
    ['with Cookie', film['cookie'] ?? 0],
    ['with a cache-buster _=', film['cacheBust'] ?? 0],
    ['to an unknown address', film['unknownAddress'] ?? 0],
  ].filter(([, count]) => Number(count) > 0);
  if (requests === 0) return { ok: false, detail: 'the server saw no request for the film (an empty proof is not a pass)' };
  if (bad.length > 0)
    return {
      ok: false,
      detail: `of ${String(requests)} request(s) for the film: ${bad.map(([what, count]) => `${String(count)} ${String(what)}`).join(', ')}`,
    };
  return {
    ok: true,
    detail: `all ${String(requests)} request(s) for the film: no Authorization, no Cookie, no _= in the address, only known addresses`,
  };
}

/**
 * @param {FilmAction} action
 * @param {FilmContext} context
 * @returns {Promise<import('./device.mjs').Check>}
 */
export async function runFilmAction(action, context) {
  const { adb, sleep } = context;
  const [name = '', ...rest] = action.split(':');
  const value = rest.join(':');
  /** @param {boolean} ok @param {string} detail @returns {import('./device.mjs').Check} */
  const check = (ok, detail) => ({ action: /** @type {import('./device.mjs').DeviceAction} */ (action), ok, detail });
  /** @returns {Promise<FilmReport | null>} */
  const report = async () => {
    const answer = await context.uploadControl?.('GET', '/control/photos-report');
    return answer !== undefined && answer !== null && answer.status === 200 ? /** @type {FilmReport} */ (answer.body) : null;
  };
  /** @type {Map<string, unknown>} */
  const memory = context.memory ?? new Map();
  switch (name) {
    case 'film-fixture': {
      const counted = await report();
      if (counted === null) return check(false, 'the report of the photos part could not be read');
      return check(
        counted.videoLoaded,
        counted.videoLoaded ? 'the MP4 fixture of the bucket is loaded' : 'NO MP4 FIXTURE (set EVIA_E2E_VIDEO_FIXTURE or ANDROID_HOME)',
      );
    }
    case 'film-throttle': {
      const answer = await context.uploadControl?.('POST', '/control/photos-video-throttle', { ms: Number(value) });
      return check(
        answer !== undefined && answer !== null && answer.status === 200,
        `control photos-video-throttle: ${String(answer?.status)}`,
      );
    }
    case 'film-manifest': {
      const judged = judgeFilmManifest(adb(...cameraCommands.dumpsysPackage()));
      return check(judged.ok, judged.detail);
    }
    case 'film-expire': {
      const answer = await context.uploadControl?.('POST', '/control/photos-video-expire', { count: Number(value) });
      return check(
        answer !== undefined && answer !== null && answer.status === 200,
        `control photos-video-expire: ${String(answer?.status)}`,
      );
    }
    case 'film-requests': {
      /** @type {Judgement} */
      let judged = { ok: false, detail: 'the report of the photos part could not be read' };
      for (let attempt = 0; attempt < REQUEST_POLLS; attempt += 1) {
        if (attempt > 0) await sleep(PAUSE_MS);
        const counted = await report();
        if (counted === null) continue;
        judged = judgeRequests(value, filmCounters(counted));
        if (judged.ok) break;
      }
      return check(judged.ok, judged.detail);
    }
    case 'film-headers': {
      const counted = await report();
      if (counted === null) return check(false, 'the report of the photos part could not be read');
      const judged = judgeFilmHeaders(counted);
      return check(judged.ok, judged.detail);
    }
    case 'film-disk-baseline': {
      adb(...photosCommands.logBuffer());
      adb(...photosCommands.logClear());
      const snapshot = takeFilmSnapshot(adb);
      if (snapshot === null)
        return check(false, 'a search of the app directories failed (run-as / grep / find); a search that cannot run proves nothing');
      memory.set('film-baseline', snapshot);
      return check(
        true,
        `baseline: ftyp in ${String(snapshot.container.size)} file(s), E2EMARK in ${String(snapshot.mark.size)}, film/cache names ${String(snapshot.names.size)}, external ${String(snapshot.externalContainer.size + snapshot.externalMark.size + snapshot.externalNames.size)}; http-cache entries ${String(classifyCache(snapshot.cache.names).entries)}; log buffer ${LOG_BUFFER}, cleared`,
      );
    }
    case 'film-disk-check': {
      const baseline = /** @type {FilmSnapshot | undefined} */ (memory.get('film-baseline'));
      if (baseline === undefined) return check(false, 'no baseline (film-disk-baseline did not run in this run)');
      const now = takeFilmSnapshot(adb);
      if (now === null)
        return check(false, 'a search of the app directories failed (run-as / grep / find); a search that cannot run proves nothing');
      const judged = judgeFilmDisk(baseline, now);
      return check(judged.ok, judged.detail);
    }
    case 'film-disk-control': {
      const baseline = /** @type {FilmSnapshot | undefined} */ (memory.get('film-baseline'));
      if (baseline === undefined) return check(false, 'no baseline (film-disk-baseline did not run in this run)');
      const planted = adb(...filmCommands.plantControl());
      if (planted.status !== 0) return check(false, 'the control file could not be planted (run-as)');
      const now = takeFilmSnapshot(adb);
      adb(...filmCommands.removeControl());
      if (now === null) return check(false, 'a search of the app directories failed after the control file was planted');
      const judged = judgeFilmControl(baseline, now);
      return check(judged.ok, judged.detail);
    }
    default:
      return check(false, `unknown film step "${name}"`);
  }
}
