// @ts-check
/**
 * Device and server steps of the photo scenarios (EVM-142 AC2-AC5; flows 140-143 of apps/mobile/e2e; ADR-0015). The proof of AC5 is "nothing of a picture stays on the
 * phone and nothing of an address is logged", and an empty search proves nothing, so the proof has the shape of every proof of this tool:
 *
 * - a BASELINE of the install before any picture was viewed (`photos-disk-baseline`: the files whose CONTENT holds `WEBPVP8` - the signature of a WebP after
 *   `RIFF....WEBP` - and the marker `E2EMARK` of the signed addresses of the scenario server, in `/data/data/<package>` and `/sdcard/Android/data/<package>`, and the
 *   entries of `cache/http-cache`, the cache of the HTTP client of the app on the disk; the log buffer is made big and cleared);
 * - the CHECKS after the screens were used (`photos-disk-check`: no file with those contents beyond the baseline, the HTTP cache holds only its `journal*` files;
 *   `photos-logcat-clean`: no address of the bucket, no `X-Amz-Signature`, no `E2EMARK` in the log of the app - the lines of the Maestro driver stay out, as everywhere;
 *   `photos-headers`: the server saw `Cache-Control: no-store` on every request of an image, and no `Authorization`, no `Cookie` and no `_=` in the address);
 * - the POSITIVE CONTROL on the SAME install (`photos-control-check`, after the hook `cache: control fetch` fetched `/bucket/control.webp` with the plain global `fetch`
 *   and WITHOUT `no-store`, which the server answers `private, max-age=300`): the very same search MUST now find the cache file with the WebP bytes (and the entry
 *   `<md5>.0` with the address), and the very same log filter MUST find the line `E2EMARK-CTRL` that the step writes with `adb shell log`. A control that finds nothing means the proof
 *   is worthless: the step fails.
 *
 * Judgements report counts and codes - never a path, a content or an address. A file name of the HTTP cache is an md5 of an address and is not reported either.
 * @typedef {'photos-reset' | `photos-fault:${string}` | 'photos-fault-clear' | `photos-delay:${string}` | `photos-wait:${string}` | `photos-requests:${string}`
 *   | 'photos-headers' | 'photos-disk-baseline' | 'photos-disk-check' | 'photos-logcat-clean' | 'photos-view-tree-unlocked' | 'photos-view-tree-locked'
 *   | 'photos-control-check'} PhotosAction
 * @typedef {import('./device-upload.mjs').UploadContext} PhotosContext
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ ok: boolean, detail: string }} Judgement
 */
import { APPLICATION_ID } from './commands.mjs';
import { lockCommands, findLeaks, parseViewTree, COVER_ID, COVER_TITLE } from './device-lock.mjs';
import { MAESTRO_LINE } from './device-upload.mjs';
import { READY_IDS } from './photos-stub.mjs';

export const PHOTOS_ACTION_NAMES = new Set([
  'photos-reset',
  'photos-fault',
  'photos-fault-clear',
  'photos-delay',
  'photos-wait',
  'photos-requests',
  'photos-headers',
  'photos-disk-baseline',
  'photos-disk-check',
  'photos-logcat-clean',
  'photos-view-tree-unlocked',
  'photos-view-tree-locked',
  'photos-control-check',
]);

/** @param {string} action @returns {boolean} */
export function isPhotosAction(action) {
  return PHOTOS_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** The signature of a WebP file after `RIFF....WEBP` (`VP8 `, `VP8L`, `VP8X`) and the marker of the signed addresses of the scenario server. */
export const WEBP_SIGNATURE = 'WEBPVP8';
export const ADDRESS_MARK = 'E2EMARK';
/** The line the positive control writes to the log with the tag `E2E` (`adb shell log -t E2E`): the same filter MUST find it. */
export const CONTROL_LOG_LINE = 'E2EMARK-CTRL';
/** The log filter: an address of the bucket, the signature parameter, the marker. */
export const LEAK_IN_LOG = /10\.0\.2\.2:\d+\/bucket|\/bucket\/photos\/|X-Amz-Signature|E2EMARK/;
/** The two files of an entry of the cache of OkHttp: `<md5>.0` (the headers and the ADDRESS) and `<md5>.1` (the body, here the picture). */
const CACHE_ENTRY = /^[0-9a-f]{32}\.[01]$/;
const LOG_BUFFER = '16M';
const NEWLINE = /\r?\n/;
const PAUSE_MS = 1000;
const SAMPLES = 3;
/** How many times (a second apart) `photos-requests` reads the counters of the server before it gives up. */
const REQUEST_POLLS = 20;

/** The data directory of the app and the cache of its HTTP client (OkHttp: `cacheDir/http-cache`). */
const INTERNAL = `/data/data/${APPLICATION_ID}`;
const EXTERNAL = `/sdcard/Android/data/${APPLICATION_ID}`;
const HTTP_CACHE = 'cache/http-cache';

/** Commands of the photo steps (arguments of adb after `-s <serial>`). The patterns are fixed text. */
export const photosCommands = {
  /** @param {string} pattern one of the two fixed words */
  grepInternal: (pattern) => ['shell', `run-as ${APPLICATION_ID} grep -r -l -a ${pattern} ${INTERNAL}`],
  /** @param {string} pattern */
  grepExternal: (pattern) => ['shell', `grep -r -l -a ${pattern} ${EXTERNAL}`],
  externalExists: () => ['shell', `ls -d ${EXTERNAL}`],
  listCache: () => ['shell', `run-as ${APPLICATION_ID} ls -1 ${HTTP_CACHE}`],
  logBuffer: () => ['logcat', '-G', LOG_BUFFER],
  logClear: () => ['logcat', '-c'],
  logcat: () => ['logcat', '-d'],
  /** The line of the positive control: the same tag and the same filter as every other line of the log. */
  logControl: () => ['shell', 'log', '-t', 'E2E', CONTROL_LOG_LINE],
};

/**
 * `grep -r -l` exits 1 and prints nothing when no file matched, 0 and the names when some did; anything else (2 = an unreadable file, no run-as) is a failure of the step.
 * @param {Outcome} outcome
 * @returns {Set<string> | null} the matching files, `null` = the search failed
 */
export function matchedFiles(outcome) {
  if (outcome.status === 1 && outcome.stdout.trim() === '') return new Set();
  if (outcome.status !== 0) return null;
  return new Set(outcome.stdout.split(NEWLINE).filter((line) => line.trim() !== ''));
}

/**
 * The entries of `cache/http-cache`: `missing` when the directory is not there (nothing was ever cached), else the names.
 * @param {Outcome} outcome
 * @returns {{ missing: boolean, names: string[] } | null} `null` = the listing failed for another reason
 */
export function cacheEntries(outcome) {
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  if (outcome.status !== 0) return /No such file or directory/i.test(text) ? { missing: true, names: [] } : null;
  return { missing: false, names: outcome.stdout.split(NEWLINE).filter((line) => line.trim() !== '') };
}

/** @param {readonly string[]} names @returns {{ journal: number, entries: number, other: number }} */
export function classifyCache(names) {
  const journal = names.filter((name) => name.startsWith('journal')).length;
  const entries = names.filter((name) => CACHE_ENTRY.test(name)).length;
  return { journal, entries, other: names.length - journal - entries };
}

/**
 * @typedef {{ webp: Set<string>, mark: Set<string>, externalWebp: Set<string>, externalMark: Set<string>, cache: { missing: boolean, names: string[] } }} Snapshot
 * What the app directories hold: the files whose contents have the signature of a WebP or the marker of an address, and the HTTP cache.
 * @param {(...args: string[]) => Outcome} adb
 * @returns {Snapshot | null} `null` = a search failed (the step fails: a search that could not run proves nothing)
 */
export function takeSnapshot(adb) {
  const webp = matchedFiles(adb(...photosCommands.grepInternal(WEBP_SIGNATURE)));
  const mark = matchedFiles(adb(...photosCommands.grepInternal(ADDRESS_MARK)));
  const cache = cacheEntries(adb(...photosCommands.listCache()));
  // the external directory of the app is not there on some images; a missing one holds nothing, a present one is searched like the internal one
  const hasExternal = adb(...photosCommands.externalExists()).status === 0;
  /** @type {Set<string> | null} */
  const externalWebp = hasExternal ? matchedFiles(adb(...photosCommands.grepExternal(WEBP_SIGNATURE))) : new Set();
  /** @type {Set<string> | null} */
  const externalMark = hasExternal ? matchedFiles(adb(...photosCommands.grepExternal(ADDRESS_MARK))) : new Set();
  if (webp === null || mark === null || cache === null || externalWebp === null || externalMark === null) return null;
  return { webp, mark, externalWebp, externalMark, cache };
}

/** @param {Set<string>} now @param {Set<string>} before @returns {number} the files that were not in the baseline */
const added = (now, before) => [...now].filter((file) => !before.has(file)).length;

/**
 * The negative judgement of AC5: no file beyond the baseline holds the picture or the address, and the cache of the HTTP client holds its journal only.
 * @param {Snapshot} baseline @param {Snapshot} now @returns {Judgement}
 */
export function judgeDisk(baseline, now) {
  const webp = added(now.webp, baseline.webp);
  const mark = added(now.mark, baseline.mark);
  const externalWebp = added(now.externalWebp, baseline.externalWebp);
  const externalMark = added(now.externalMark, baseline.externalMark);
  const cache = classifyCache(now.cache.names);
  const summary = `WEBPVP8 in ${String(webp)} file(s) beyond the baseline (${String(baseline.webp.size)} before), E2EMARK in ${String(mark)} (${String(baseline.mark.size)} before), external ${String(externalWebp)}/${String(externalMark)}; http-cache: ${now.cache.missing ? 'no directory' : `${String(cache.journal)} journal file(s), ${String(cache.entries)} entry file(s) <md5>.0/.1, ${String(cache.other)} other`}`;
  const clean = webp === 0 && mark === 0 && externalWebp === 0 && externalMark === 0 && cache.entries === 0 && cache.other === 0;
  return { ok: clean, detail: clean ? `no trace: ${summary}` : `TRACE ON THE DISK: ${summary}` };
}

/**
 * The lines of the log that the filter catches, outside the Maestro driver.
 * @param {Outcome} logcat
 * @returns {{ total: number, leaks: number } | null} `null` = the log could not be read
 */
export function countLogLeaks(logcat) {
  if (logcat.status !== 0) return null;
  const lines = logcat.stdout.split(NEWLINE).filter((line) => line.trim() !== '' && !MAESTRO_LINE.test(line));
  return { total: lines.length, leaks: lines.filter((line) => LEAK_IN_LOG.test(line)).length };
}

/**
 * @param {Outcome} logcat @returns {Judgement}
 */
export function judgeLog(logcat) {
  const counted = countLogLeaks(logcat);
  if (counted === null) return { ok: false, detail: 'logcat could not be read' };
  // an empty log is an empty proof (a buffer that was cleared by something else, a dead logcat)
  if (counted.total === 0) return { ok: false, detail: 'logcat is empty (an empty proof is not a pass)' };
  return counted.leaks === 0
    ? {
        ok: true,
        detail: `logcat (${String(counted.total)} lines outside the Maestro driver): no address of the bucket, no X-Amz-Signature, no E2EMARK`,
      }
    : {
        ok: false,
        detail: `logcat: ${String(counted.leaks)} line(s) with an address of the bucket, a signature or the marker (of ${String(counted.total)})`,
      };
}

/**
 * The POSITIVE CONTROL of the disk: after the fetch WITHOUT `no-store` the cache of the HTTP client MUST hold the picture (`WEBPVP8` in a file beyond the baseline), its two entry files
 * `<md5>.0` and `<md5>.1`, and the address (`E2EMARK` in a file beyond the baseline). If the search finds nothing, the search cannot be trusted.
 * @param {Snapshot} baseline @param {Snapshot} now @returns {Judgement}
 */
export function judgeDiskControl(baseline, now) {
  const webp = added(now.webp, baseline.webp);
  const mark = added(now.mark, baseline.mark);
  const cache = classifyCache(now.cache.names);
  const found = webp >= 1 && mark >= 1 && cache.entries >= 2;
  const summary = `WEBPVP8 in ${String(webp)} new file(s), E2EMARK in ${String(mark)} new file(s), http-cache entry files ${String(cache.entries)} (<md5>.0 and .1)`;
  return found
    ? { ok: true, detail: `positive control found the cached picture: ${summary}` }
    : { ok: false, detail: `POSITIVE CONTROL FOUND NOTHING (the proof is void): ${summary}` };
}

/**
 * The positive control of the log: the filter MUST catch the line the step wrote (and nothing may have been caught before it).
 * @param {Outcome} before the log before the line was written @param {Outcome} after the log after it @returns {Judgement}
 */
export function judgeLogControl(before, after) {
  const was = countLogLeaks(before);
  const now = countLogLeaks(after);
  if (was === null || now === null) return { ok: false, detail: 'logcat could not be read' };
  const found = now.leaks - was.leaks;
  return found >= 1
    ? {
        ok: true,
        detail: `positive control: the log filter caught the line ${CONTROL_LOG_LINE} (${String(was.leaks)} line(s) before it, ${String(now.leaks)} after)`,
      }
    : {
        ok: false,
        detail: `POSITIVE CONTROL OF THE LOG FOUND NOTHING (the filter is blind; ${String(was.leaks)} before, ${String(now.leaks)} after)`,
      };
}

/** The counters of the report of the photos part of the scenario server. @typedef {{ urls: { thumbnail: number, preview: number, original: number, byAsset: Record<string, number> }, images: Record<string, number>, delayMs: number, faults: number }} Report */

/** @param {Report} report @returns {Record<string, number>} the counters by the names the steps use */
export function reportCounters(report) {
  const unready = Object.entries(report.urls.byAsset)
    .filter(([id]) => !READY_IDS.includes(id))
    .reduce((sum, [, count]) => sum + count, 0);
  const images = report.images;
  return {
    thumbnailUrls: report.urls.thumbnail,
    previewUrls: report.urls.preview,
    originalUrls: report.urls.original,
    unreadyUrls: unready,
    thumbnailImages: images['thumbnail'] ?? 0,
    previewImages: images['preview'] ?? 0,
    controlImages: images['control'] ?? 0,
    okImages: images['ok'] ?? 0,
    failedImages: images['failed'] ?? 0,
    abandoned: images['abandoned'] ?? 0,
  };
}

/**
 * `thumbnailUrls=3,previewImages>=2`: every term must hold. An unknown name or a malformed term is a failure.
 * @param {string} expression @param {Record<string, number>} counters @returns {Judgement}
 */
export function judgeRequests(expression, counters) {
  const terms = expression.split(',').filter((term) => term !== '');
  if (terms.length === 0) return { ok: false, detail: 'no expectation given' };
  /** @type {string[]} */
  const lines = [];
  let ok = true;
  for (const term of terms) {
    const match = /^([a-zA-Z]+)(>=|=)(\d+)$/.exec(term);
    const actual = match === null ? undefined : counters[match[1] ?? ''];
    if (match === null || actual === undefined) return { ok: false, detail: `unknown expectation "${term}"` };
    const expected = Number(match[3]);
    const holds = match[2] === '=' ? actual === expected : actual >= expected;
    if (!holds) ok = false;
    lines.push(`${match[1] ?? ''}=${String(actual)} (expected ${match[2] ?? ''}${String(expected)})${holds ? '' : ' MISMATCH'}`);
  }
  return { ok, detail: lines.join(', ') };
}

/**
 * AC5: every request of an image of the app (the control image excluded) had `Cache-Control: no-store`, no `Authorization`, no `Cookie` and no `_=` in the address, and the app
 * made some requests at all (a run without a request proves nothing).
 * @param {Report} report @returns {Judgement}
 */
export function judgeHeaders(report) {
  const images = report.images;
  const requests = (images['thumbnail'] ?? 0) + (images['preview'] ?? 0);
  const noStore = images['noStore'] ?? 0;
  const bad = [
    ['without no-store', images['notNoStore'] ?? 0],
    ['with Authorization', images['authorization'] ?? 0],
    ['with Cookie', images['cookie'] ?? 0],
    ['with a cache-buster _=', images['cacheBust'] ?? 0],
    ['to an unknown address', images['unknownAddress'] ?? 0],
  ].filter(([, count]) => Number(count) > 0);
  if (requests === 0) return { ok: false, detail: 'the server saw no request of an image (an empty proof is not a pass)' };
  if (bad.length > 0 || noStore !== requests)
    return {
      ok: false,
      detail: `of ${String(requests)} request(s) of an image: ${bad.map(([what, count]) => `${String(count)} ${String(what)}`).join(', ') || `only ${String(noStore)} with no-store`}`,
    };
  return {
    ok: true,
    detail: `all ${String(requests)} request(s) of an image carried Cache-Control: no-store, no Authorization, no Cookie, no _= in the address`,
  };
}

/** What a screen of the photos shows (the synthetic values of the replica of the scenario server): none of them may be in the tree under the cover. */
export const PHOTO_VALUES = Object.freeze({
  'category completed_work': 'Po zakończeniu',
  'category in_progress': 'W trakcie prac',
  'category before_work': 'Stan przed pracami',
  description: 'Opis testowy',
  'state processing': 'Przygotowujemy podgląd',
  'state quarantined': 'Plik zatrzymany',
  'tile id': 'photo-tile',
  'preview id': 'photo-preview',
  'grid id': 'order-photos',
});
/** What the positive control must find in the tree of the OPEN preview (unlocked): the category, the description and the id of the preview. */
export const PHOTO_MUST_SHOW = Object.freeze(['category completed_work', 'description', 'preview id']);

/**
 * @param {string} xml @returns {{ nodes: number, leaks: { value: string, attribute: string, nodes: number }[], cover: boolean } | null} `null` = no tree of the app
 */
function readTree(xml) {
  const nodes = parseViewTree(xml);
  const own = (nodes ?? []).filter((node) => node.packageName === APPLICATION_ID);
  if (own.length === 0) return null;
  return {
    nodes: own.length,
    leaks: findLeaks(own, PHOTO_VALUES),
    cover: own.some((node) => node.resourceId.endsWith(COVER_ID) || node.text === COVER_TITLE),
  };
}

/**
 * @param {PhotosAction} action
 * @param {PhotosContext} context
 * @returns {Promise<import('./device.mjs').Check>}
 */
export async function runPhotosAction(action, context) {
  const { adb, sleep } = context;
  const [name = '', ...rest] = action.split(':');
  const value = rest.join(':');
  /** @param {boolean} ok @param {string} detail @returns {import('./device.mjs').Check} */
  const check = (ok, detail) => ({ action: /** @type {import('./device.mjs').DeviceAction} */ (action), ok, detail });
  /** @param {string} method @param {string} path @param {unknown} [body] */
  const server = async (method, path, body) => {
    const answer = await context.uploadControl?.(method, path, body);
    return answer ?? null;
  };
  /** @param {string} path @param {unknown} [body] @returns {Promise<import('./device.mjs').Check>} */
  const post = async (path, body) => {
    const answer = await server('POST', path, body);
    return check(
      answer !== null && answer.status === 200,
      answer === null ? 'the control port did not answer' : `control ${path}: ${String(answer.status)}`,
    );
  };
  /** @returns {Promise<Report | null>} */
  const report = async () => {
    const answer = await server('GET', '/control/photos-report');
    return answer !== null && answer.status === 200 ? /** @type {Report} */ (answer.body) : null;
  };
  /** @type {Map<string, unknown>} */
  const memory = context.memory ?? new Map();
  switch (name) {
    case 'photos-reset':
      return post('/control/photos-reset');
    case 'photos-fault-clear':
      return post('/control/photos-fault-clear');
    case 'photos-fault': {
      // `photos-fault:<url|image>:<status>[:<count>[:<variant>]]` - count 0 or missing = until cleared
      const [target, status, count, variant] = rest;
      return post('/control/photos-fault', {
        target,
        status: Number(status),
        ...(count === undefined || Number(count) === 0 ? {} : { count: Number(count) }),
        ...(variant === undefined ? {} : { variant }),
      });
    }
    case 'photos-delay':
      return post('/control/photos-delay', { ms: Number(value) });
    case 'photos-wait': {
      const ms = Number(value);
      if (!Number.isInteger(ms) || ms < 0 || ms > 120_000) return check(false, 'a wait of 0-120000 ms is expected');
      await sleep(ms);
      return check(true, `waited ${String(ms)} ms`);
    }
    case 'photos-requests': {
      // the app asks lazily and the flow ends the moment its last screen is there: the counters are polled until they hold (or the wait is over)
      /** @type {Judgement} */
      let judged = { ok: false, detail: 'the report of the photos part could not be read' };
      for (let attempt = 0; attempt < REQUEST_POLLS; attempt += 1) {
        if (attempt > 0) await sleep(PAUSE_MS);
        const counted = await report();
        if (counted === null) continue;
        judged = judgeRequests(value, reportCounters(counted));
        if (judged.ok) break;
      }
      return check(judged.ok, judged.detail);
    }
    case 'photos-headers': {
      const counted = await report();
      if (counted === null) return check(false, 'the report of the photos part could not be read');
      const judged = judgeHeaders(counted);
      return check(judged.ok, judged.detail);
    }
    case 'photos-disk-baseline': {
      adb(...photosCommands.logBuffer());
      adb(...photosCommands.logClear());
      const snapshot = takeSnapshot(adb);
      if (snapshot === null)
        return check(false, 'a search of the app directories failed (run-as / grep); a search that cannot run proves nothing');
      memory.set('photos-baseline', snapshot);
      const cache = classifyCache(snapshot.cache.names);
      return check(
        true,
        `baseline: WEBPVP8 in ${String(snapshot.webp.size)} file(s), E2EMARK in ${String(snapshot.mark.size)}, external ${String(snapshot.externalWebp.size)}/${String(snapshot.externalMark.size)}; http-cache: ${snapshot.cache.missing ? 'no directory' : `${String(cache.journal)} journal, ${String(cache.entries)} entry file(s), ${String(cache.other)} other`}; log buffer ${LOG_BUFFER}, cleared`,
      );
    }
    case 'photos-disk-check': {
      const baseline = /** @type {Snapshot | undefined} */ (memory.get('photos-baseline'));
      if (baseline === undefined) return check(false, 'no baseline (photos-disk-baseline did not run in this run)');
      const now = takeSnapshot(adb);
      if (now === null)
        return check(false, 'a search of the app directories failed (run-as / grep); a search that cannot run proves nothing');
      const judged = judgeDisk(baseline, now);
      return check(judged.ok, judged.detail);
    }
    case 'photos-logcat-clean': {
      const judged = judgeLog(adb(...photosCommands.logcat()));
      return check(judged.ok, judged.detail);
    }
    case 'photos-control-check': {
      const baseline = /** @type {Snapshot | undefined} */ (memory.get('photos-baseline'));
      if (baseline === undefined) return check(false, 'no baseline (photos-disk-baseline did not run in this run)');
      const now = takeSnapshot(adb);
      if (now === null) return check(false, 'a search of the app directories failed after the control fetch');
      const disk = judgeDiskControl(baseline, now);
      const before = adb(...photosCommands.logcat());
      adb(...photosCommands.logControl());
      const after = adb(...photosCommands.logcat());
      const log = judgeLogControl(before, after);
      const counted = await report();
      const served = (counted?.images['control'] ?? 0) >= 1;
      return check(
        disk.ok && log.ok && served,
        `${disk.detail}; ${log.detail}; server: ${served ? 'saw the control request' : 'DID NOT SEE the control request'}`,
      );
    }
    case 'photos-view-tree-unlocked':
    case 'photos-view-tree-locked': {
      const locked = name === 'photos-view-tree-locked';
      let nodes = 0;
      for (let sample = 0; sample < (locked ? SAMPLES : 1); sample += 1) {
        if (sample > 0) await sleep(PAUSE_MS);
        const dump = adb(...lockCommands.dump());
        const tree = dump.status === 0 ? readTree(dump.stdout) : null;
        if (tree === null)
          return check(false, 'the dump of the view tree is empty or is not the tree of the app (an empty proof is not a pass)');
        nodes = tree.nodes;
        if (locked && !tree.cover)
          return check(false, `${String(tree.nodes)} node(s) of the app but not the cover (the app is not locked)`);
        if (locked && tree.leaks.length > 0)
          return check(
            false,
            `LEAK under the cover (sample ${String(sample + 1)}): ${tree.leaks.map((leak) => `${leak.value} in ${leak.attribute} (${String(leak.nodes)})`).join('; ')}`,
          );
        if (!locked) {
          const seen = new Set(tree.leaks.map((leak) => leak.value));
          const missing = PHOTO_MUST_SHOW.filter((key) => !seen.has(key));
          if (missing.length > 0)
            return check(false, `positive control: the open preview does not show ${missing.join(', ')} in the tree (the read is blind)`);
        }
      }
      return check(
        true,
        locked
          ? `${String(nodes)} node(s) of the app with the cover, ${String(SAMPLES)} reads: none of the ${String(Object.keys(PHOTO_VALUES).length)} values of the photos screens`
          : `positive control: the open preview shows ${PHOTO_MUST_SHOW.join(', ')} in the tree (${String(nodes)} nodes)`,
      );
    }
    default:
      return check(false, `unknown photos step "${name}"`);
  }
}
