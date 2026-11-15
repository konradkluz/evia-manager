// @ts-check
/**
 * Device and server steps of the upload scenarios (EVM-130 stage C, AC1–AC6; ADR-0015). They sit next to the steps of the local store
 * (device.mjs, EVM-093) and use the same rules: builders return arguments for adb with fixed text (the only value that goes into a shell
 * string is an asset id checked against the UUID pattern), every judgement reports counts and codes — never a path inside the app, a token, an
 * address of a part or a file content — and an unexpected answer or a failed command is a failure, never a pass.
 *
 * The steps that read or steer the scenario server go through `context.uploadControl` (the control port, loopback only): the checkpoint
 * (objects per asset, SHA-256, orphaned multiparts), the faults, the delay of the answer to a part, the verdict of `complete`, the file state,
 * the expiry of the access token. The action names with a value carry it after a colon (`upload-checkpoint:4`).
 *
 * What the system dumps (`dumpsys jobscheduler`, `dumpsys notification`) differs between Android releases; the judges read the lines they
 * need leniently, and the first run on the emulator is what shows whether the patterns fit (docs/qa/EVM-130).
 */
import { APPLICATION_ID } from './commands.mjs';

/** The token words of the scenario server (fixed test words): none of them may appear in a log or a file of the app. */
export const TOKEN_WORDS = /e2e-(?:access|refresh|challenge|installation)-/;
/** What a signed address of a part carries; the app must never log it. */
export const ADDRESS_PARAMETER = 'X-Amz-';
/** A logcat line of the Maestro test driver (`brief`: `I/Maestro ( 6458):`; `threadtime`: `… 6458  6470 I Maestro : …`). */
export const MAESTRO_LINE = /(?:^|\s)[VDIWEF][/ ]\s*Maestro\s*(?:\(\s*\d+\))?\s*:/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The directory of the module below the data directory of the app (`noBackupFilesDir/evia-upload`; UploadFiles.kt). */
export const UPLOAD_ROOT = 'no_backup/evia-upload';
export const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';
/** How long a step waits for the server to see the end of a transfer, and for the app to delete an original. */
export const CHECKPOINT_WAIT_MS = 240_000;
export const ORIGINAL_WAIT_MS = 90_000;
const POLL_MS = 2000;
const NEWLINE = /\r?\n/;

/**
 * @typedef {'logcat-clear' | 'logcat-clean' | 'tokens-not-in-clear' | 'jobs-armed' | 'jobs-none' | 'app-files-none' | 'original-present'
 *   | 'original-absent' | 'notification-private' | 'notifications-revoke' | 'notifications-grant' | 'upload-reset' | 'upload-none-yet'
 *   | 'upload-active:on' | 'upload-active:off'
 *   | 'upload-expire-access' | 'upload-refreshed' | `upload-checkpoint:${string}` | `upload-fault:${string}` | `upload-fault-clear:${string}`
 *   | `upload-part-delay:${string}` | `upload-verdict:${string}` | `upload-file-state:${string}`} UploadAction
 */
/** @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome */
/**
 * @typedef {{ status: number, body: unknown }} ControlAnswer
 * @typedef {{
 *   adb: (...args: string[]) => Outcome,
 *   sleep: (ms: number) => Promise<void>,
 *   uploadControl?: (method: string, path: string, body?: unknown) => Promise<ControlAnswer | null>,
 * }} UploadContext
 * @typedef {{ ok: boolean, detail: string }} Judgement
 * @typedef {{
 *   state: string, objects: number, sha256: string | null, declaredSize: number | null, sessions: number, activeParts: number, partCount: number | null,
 * }} AssetPoint
 * @typedef {{
 *   assets: Record<string, AssetPoint>,
 *   orphanedMultiparts: number,
 *   openMultiparts: number,
 *   counters: Record<string, number>,
 * }} Checkpoint
 */

/** The actions of this module (the part before the colon is the name). */
export const UPLOAD_ACTION_NAMES = new Set([
  'logcat-clear',
  'logcat-clean',
  'tokens-not-in-clear',
  'jobs-armed',
  'jobs-none',
  'app-files-none',
  'original-present',
  'original-absent',
  'notification-private',
  'notifications-revoke',
  'notifications-grant',
  'upload-active',
  'upload-reset',
  'upload-none-yet',
  'upload-expire-access',
  'upload-refreshed',
  'upload-checkpoint',
  'upload-fault',
  'upload-fault-clear',
  'upload-part-delay',
  'upload-verdict',
  'upload-file-state',
]);

/** @param {string} action @returns {boolean} */
export function isUploadAction(action) {
  return UPLOAD_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/** Commands of the upload steps (arguments of adb after `-s <serial>`). */
export const uploadCommands = {
  logcatClear: () => ['logcat', '-c'],
  logcat: () => ['logcat', '-d'],
  /** The synthetic token words in any file of the app (the refresh token lives only encrypted in the store of the module). */
  grepTokens: () => ['shell', `run-as ${APPLICATION_ID} grep -r -l -a -E e2e-(access|refresh)- /data/data/${APPLICATION_ID}`],
  dumpsysJobs: () => ['shell', 'dumpsys', 'jobscheduler', APPLICATION_ID],
  /** Every file of the module (jobs, originals, token, markers); a missing directory is not an error of the step. */
  listFiles: () => ['shell', `run-as ${APPLICATION_ID} find ${UPLOAD_ROOT} -type f`],
  /** @param {string} assetId a UUID (checked) */
  listOriginal: (assetId) => ['shell', `run-as ${APPLICATION_ID} ls ${UPLOAD_ROOT}/originals/${checkedAssetId(assetId)}`],
  /** @param {string} assetId a UUID (checked) */
  digestOriginal: (assetId) => ['shell', `run-as ${APPLICATION_ID} sha256sum ${UPLOAD_ROOT}/originals/${checkedAssetId(assetId)}`],
  dumpsysNotification: () => ['shell', 'dumpsys', 'notification', '--noredact'],
  /** @param {boolean} on */
  notificationPermission: (on) => ['shell', 'pm', on ? 'grant' : 'revoke', APPLICATION_ID, NOTIFICATION_PERMISSION],
};

/** @param {string} assetId */
function checkedAssetId(assetId) {
  if (!UUID.test(assetId)) throw new Error('not an asset id');
  return assetId;
}

/**
 * AC5: the log holds no address of a part (`X-Amz-`) and no token word of the scenario server. Lines of the Maestro driver are the harness
 * (they print the texts of the views it reads) and stay out. Counts only.
 * @param {Outcome} logcat
 * @returns {Judgement}
 */
export function judgeLogcatSecrets(logcat) {
  if (logcat.status !== 0) return { ok: false, detail: 'logcat could not be read' };
  const lines = logcat.stdout.split(NEWLINE).filter((line) => !MAESTRO_LINE.test(line));
  const addresses = lines.filter((line) => line.includes(ADDRESS_PARAMETER)).length;
  const tokens = lines.filter((line) => TOKEN_WORDS.test(line)).length;
  return addresses === 0 && tokens === 0
    ? { ok: true, detail: `logcat (${String(lines.length)} lines): no X-Amz- parameter, no token of the scenario server` }
    : { ok: false, detail: `logcat: ${String(addresses)} line(s) with X-Amz-, ${String(tokens)} line(s) with a token word` };
}

/**
 * AC3: `grep -r -l` exits 1 and prints nothing when no file matched; 0 = found (the count only); anything else = the tool failed.
 * @param {Outcome} outcome
 * @returns {Judgement}
 */
export function judgeTokensNotInClear(outcome) {
  if (outcome.status === 1 && outcome.stdout.trim() === '')
    return { ok: true, detail: 'no file of the app data carries a token of the scenario server' };
  if (outcome.status === 0) {
    const files = outcome.stdout.split(NEWLINE).filter((line) => line.trim() !== '').length;
    return { ok: false, detail: `a token of the scenario server is in ${String(files)} file(s) of the app data` };
  }
  return { ok: false, detail: `grep over the app data failed (exit ${String(outcome.status)})` };
}

/**
 * The upload jobs of the app in `dumpsys jobscheduler <package>`: the distinct `JOB #<uid>/<id>` of the service `UploadJobService`.
 * @param {string} dump
 * @returns {string[]}
 */
export function uploadJobs(dump) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const line of dump.split(NEWLINE)) {
    const job = /JOB #(\S+): \S+ \S*\/\S*UploadJobService/.exec(line)?.[1];
    if (job !== undefined) found.add(job);
  }
  return [...found].sort();
}

/**
 * AC1 (armed after `applied`), AC5 (none after the wipe): the number of upload jobs registered for the app.
 * @param {Outcome} dump
 * @param {'armed' | 'none'} expected
 * @returns {Judgement}
 */
export function judgeJobs(dump, expected) {
  if (dump.status !== 0) return { ok: false, detail: `dumpsys jobscheduler failed (exit ${String(dump.status)})` };
  const count = uploadJobs(dump.stdout).length;
  if (expected === 'none') {
    return count === 0
      ? { ok: true, detail: 'no upload job is registered' }
      : { ok: false, detail: `${String(count)} upload job(s) are registered` };
  }
  return count > 0
    ? { ok: true, detail: `${String(count)} upload job(s) are registered` }
    : { ok: false, detail: 'no upload job is registered (dumpsys jobscheduler has no UploadJobService of the app)' };
}

/**
 * AC5: after the wipe no job file, no original, no token file is left in the directory of the module; the markers may stay. Counts only.
 * @param {Outcome} listing `find <root> -type f`
 * @returns {Judgement}
 */
export function judgeFilesGone(listing) {
  // a directory that does not exist (the module never wrote there, or the wipe removed it) prints an error and nothing else
  if (listing.status !== 0 && listing.stdout.trim() === '' && /no such file/i.test(`${listing.stderr}\n${listing.stdout}`))
    return { ok: true, detail: 'the directory of the module does not exist' };
  if (listing.status !== 0) return { ok: false, detail: `listing of the files of the module failed (exit ${String(listing.status)})` };
  const files = listing.stdout.split(NEWLINE).filter((line) => line.trim() !== '');
  const jobs = files.filter((name) => name.includes('/jobs/')).length;
  const originals = files.filter((name) => name.includes('/originals/')).length;
  const token = files.filter((name) => name.endsWith('/token.bin')).length;
  return jobs + originals + token === 0
    ? { ok: true, detail: `no job file, original or token file (${String(files.length)} other file(s) of the module)` }
    : {
        ok: false,
        detail: `${String(jobs)} job file(s), ${String(originals)} original(s), ${String(token)} token file(s) are still there`,
      };
}

/**
 * The server's idea of the checkpoint, read leniently (the control port is ours, but a wrong shape must fail loudly, not throw).
 * @param {unknown} body
 * @returns {Checkpoint | null}
 */
export function readCheckpoint(body) {
  if (typeof body !== 'object' || body === null) return null;
  const point = /** @type {Record<string, unknown>} */ (body);
  if (
    typeof point['assets'] !== 'object' ||
    point['assets'] === null ||
    typeof point['counters'] !== 'object' ||
    point['counters'] === null
  )
    return null;
  return /** @type {Checkpoint} */ (point);
}

/**
 * AC1 (before the network returns): the server has not seen a byte of the file — no part, no object, no session.
 * @param {Checkpoint} point
 * @returns {Judgement}
 */
export function judgeNothingYet(point) {
  const assets = Object.values(point.assets);
  const objects = assets.reduce((sum, asset) => sum + asset.objects, 0);
  const sessions = assets.reduce((sum, asset) => sum + asset.sessions, 0);
  const puts = point.counters['partPuts'] ?? 0;
  return objects === 0 && sessions === 0 && puts === 0 && point.openMultiparts === 0
    ? { ok: true, detail: `the server has nothing of the file yet (${String(assets.length)} asset(s) registered, 0 sessions, 0 parts)` }
    : {
        ok: false,
        detail: `the server already has ${String(objects)} object(s), ${String(sessions)} session(s), ${String(puts)} part request(s)`,
      };
}

/**
 * AC1: one object per asset, its SHA-256 equal to the SHA-256 of the original on the device (the original is still there until `clean`),
 * no orphaned multipart, no open session, and no more parts sent twice than there were interruptions (the transfer resumed from the last
 * confirmed part instead of starting again).
 * @param {Checkpoint} point
 * @param {Record<string, string | null>} originals asset id -> SHA-256 of the original on the device (`null` = no original there)
 * @param {number} interruptions
 * @returns {Judgement}
 */
export function judgeCheckpoint(point, originals, interruptions) {
  const entries = Object.entries(point.assets);
  if (entries.length === 0) return { ok: false, detail: 'the server registered no asset (the command was not applied?)' };
  const problems = [];
  for (const [id, asset] of entries) {
    if (asset.objects !== 1) problems.push(`${String(asset.objects)} object(s) of an asset (expected exactly 1)`);
    else if (asset.sha256 === null) problems.push('an object without SHA-256');
    else {
      const local = originals[id];
      if (local === undefined || local === null) {
        if (asset.state !== 'clean') problems.push(`the original is gone but the server state is ${asset.state}, not clean`);
      } else if (local !== asset.sha256) problems.push('SHA-256 of the object differs from SHA-256 of the original on the device');
    }
  }
  if (point.orphanedMultiparts !== 0) problems.push(`${String(point.orphanedMultiparts)} orphaned multipart(s)`);
  if (point.openMultiparts !== 0) problems.push(`${String(point.openMultiparts)} open multipart(s)`);
  const replaced = point.counters['partsReplaced'] ?? 0;
  if (replaced > interruptions)
    problems.push(`${String(replaced)} parts sent again (at most ${String(interruptions)} expected: one per interruption)`);
  return problems.length === 0
    ? {
        ok: true,
        detail: `${String(entries.length)} asset(s): exactly one object each, SHA-256 equal to the original, 0 orphaned multiparts, ${String(replaced)} part(s) sent again after ${String(interruptions)} interruption(s)`,
      }
    : { ok: false, detail: problems.join('; ') };
}

/**
 * AC2: the app refreshed its token by itself (the rotating refresh of the server was used) and the family was not ended by a reuse.
 * @param {Checkpoint} point
 * @returns {Judgement}
 */
export function judgeRefreshed(point) {
  const refreshes = point.counters['refreshes'] ?? 0;
  const reuse = point.counters['reuseDetected'] ?? 0;
  if (reuse > 0)
    return { ok: false, detail: `the server saw a reuse of a refresh token ${String(reuse)} time(s) (the session family ended)` };
  return refreshes > 0
    ? { ok: true, detail: `the token was refreshed ${String(refreshes)} time(s), no reuse` }
    : { ok: false, detail: 'the server saw no refresh of the token' };
}

/**
 * AC6: the notification of the app as the system keeps it: a channel with low importance (no sound, no vibration), private visibility with a
 * public version, a text of the list in the story, no numbers of orders, names or addresses, no action buttons.
 * @param {Outcome} dump `dumpsys notification --noredact`
 * @returns {Judgement}
 */
export function judgeNotification(dump) {
  if (dump.status !== 0) return { ok: false, detail: `dumpsys notification failed (exit ${String(dump.status)})` };
  const blocks = dump.stdout
    .split(/\n(?=\s*NotificationRecord\()/)
    .filter((block) => block.includes(`pkg=${APPLICATION_ID}`) && /NotificationRecord\(/.test(block));
  if (blocks.length === 0) return { ok: false, detail: 'no notification of the app is posted' };
  const block = blocks.join('\n');
  const problems = [];
  if (!/Wysyłanie \d+ z \d+ plik|Wysłano \d+ plik|Nie wysłano \d+ plik|Wysyłanie wstrzymane/.test(block))
    problems.push('the text is none of the texts of AC6');
  if (!/vis=PRIVATE/.test(block)) problems.push('the visibility is not PRIVATE');
  if (!/publicVersion=/.test(block)) problems.push('there is no public version');
  if (/ZL-E2E|Testowa|Klient|Fikcyjna/.test(block)) problems.push('the notification carries a number of an order, a name or an address');
  if (/actions=\{/.test(block)) problems.push('the notification has action buttons');
  // the channel: low importance (2), no sound, no vibration, private on the lock screen (0)
  const channel = /NotificationChannel\{[^}]*mName=Wysyłanie plików[^}]*\}/.exec(dump.stdout)?.[0] ?? '';
  if (channel === '') problems.push('the channel "Wysyłanie plików" is not in the dump');
  else {
    if (!/mImportance=2\b/.test(channel)) problems.push('the importance of the channel is not LOW');
    if (/mSound=content|mVibrationEnabled=true/.test(channel)) problems.push('the channel has a sound or a vibration');
    if (!/mLockscreenVisibility=0\b/.test(channel)) problems.push('the channel is not private on the lock screen');
  }
  return problems.length === 0
    ? {
        ok: true,
        detail:
          'notification: low-importance channel without sound and vibration, private with a public version, text of AC6, no personal data, no actions',
      }
    : { ok: false, detail: problems.join('; ') };
}

/**
 * @param {UploadContext} context
 * @param {string} method @param {string} path @param {unknown} [body]
 * @returns {Promise<ControlAnswer | null>}
 */
async function control(context, method, path, body) {
  if (context.uploadControl === undefined) return null;
  try {
    return await context.uploadControl(method, path, body);
  } catch {
    return null;
  }
}

/** @param {UploadContext} context @returns {Promise<Checkpoint | null>} */
async function checkpointOf(context) {
  const answer = await control(context, 'GET', '/control/checkpoint');
  return answer === null || answer.status !== 200 ? null : readCheckpoint(answer.body);
}

/**
 * The SHA-256 of the original of every asset on the device (`null` = no original).
 * @param {UploadContext} context @param {string[]} assetIds
 * @returns {Record<string, string | null>}
 */
function originalsOnDevice(context, assetIds) {
  /** @type {Record<string, string | null>} */
  const digests = {};
  for (const id of assetIds) {
    const answer = context.adb(...uploadCommands.digestOriginal(id));
    digests[id] = answer.status === 0 ? (/^([0-9a-f]{64})\b/i.exec(answer.stdout.trim())?.[1]?.toLowerCase() ?? null) : null;
  }
  return digests;
}

/**
 * Polls until `done` holds or the time is up; the last value is returned.
 * @template T
 * @param {UploadContext} context
 * @param {number} limitMs
 * @param {() => Promise<T> | T} read
 * @param {(value: T) => boolean} done
 * @returns {Promise<T>}
 */
async function pollUntil(context, limitMs, read, done) {
  let value = await read();
  for (let waited = 0; !done(value) && waited < limitMs; waited += POLL_MS) {
    await context.sleep(POLL_MS);
    value = await read();
  }
  return value;
}

/**
 * Runs one upload step and judges it.
 * @param {string} action the action name, with its value after a colon
 * @param {UploadContext} context
 * @returns {Promise<{ action: string, ok: boolean, detail: string }>}
 */
export async function runUploadAction(action, context) {
  const [name = '', first, second] = action.split(':');
  /** @param {boolean} ok @param {string} detail */
  const check = (ok, detail) => ({ action, ok, detail });
  /** @param {Judgement} judged */
  const judged = (judged) => check(judged.ok, judged.detail);
  /** @param {string} path @param {unknown} body @param {string} what */
  const steer = async (path, body, what) => {
    const answer = await control(context, 'POST', path, body);
    return check(
      answer !== null && answer.status >= 200 && answer.status < 300,
      answer === null ? `${what}: the control port did not answer` : `${what} (HTTP ${String(answer.status)})`,
    );
  };
  /** @param {string | undefined} text */
  const whole = (text) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : null);

  switch (name) {
    case 'logcat-clear':
      return check(context.adb(...uploadCommands.logcatClear()).status === 0, 'logcat buffer cleared');
    case 'logcat-clean':
      return judged(judgeLogcatSecrets(context.adb(...uploadCommands.logcat())));
    case 'tokens-not-in-clear':
      return judged(judgeTokensNotInClear(context.adb(...uploadCommands.grepTokens())));
    case 'jobs-armed':
    case 'jobs-none': {
      const expected = name === 'jobs-armed' ? 'armed' : 'none';
      const dump = await pollUntil(
        context,
        expected === 'armed' ? 20_000 : 0,
        () => context.adb(...uploadCommands.dumpsysJobs()),
        (outcome) => judgeJobs(outcome, expected).ok,
      );
      return judged(judgeJobs(dump, expected));
    }
    case 'app-files-none':
      return judged(judgeFilesGone(context.adb(...uploadCommands.listFiles())));
    case 'original-present':
    case 'original-absent': {
      const point = await checkpointOf(context);
      const ids = point === null ? [] : Object.keys(point.assets);
      if (ids.length === 0) return check(false, 'the server registered no asset, so there is no original to look for');
      const wantPresent = name === 'original-present';
      const present = (/** @type {string[]} */ list) => list.filter((id) => context.adb(...uploadCommands.listOriginal(id)).status === 0);
      const found = await pollUntil(
        context,
        wantPresent ? 0 : ORIGINAL_WAIT_MS,
        () => present(ids),
        (list) => (wantPresent ? list.length === ids.length : list.length === 0),
      );
      const ok = wantPresent ? found.length === ids.length : found.length === 0;
      return check(
        ok,
        `${String(found.length)} of ${String(ids.length)} original(s) on the device (expected ${wantPresent ? 'all' : 'none'})`,
      );
    }
    case 'notification-private':
      return judged(judgeNotification(context.adb(...uploadCommands.dumpsysNotification())));
    case 'notifications-revoke':
    case 'notifications-grant':
      return check(
        context.adb(...uploadCommands.notificationPermission(name === 'notifications-grant')).status === 0,
        name === 'notifications-grant' ? 'permission to notify granted' : 'permission to notify revoked',
      );
    case 'upload-active':
      // the sign-in of the run is served by the upload part (its tokens are the ones the upload operations check) only while it is on
      return first === 'on' || first === 'off'
        ? steer('/control/active', { active: first === 'on' }, `the sign-in of the run is served by the upload part: ${first}`)
        : check(false, 'upload-active needs on or off');
    case 'upload-reset':
      return steer('/control/reset', {}, 'the scenario server of the upload part reset');
    case 'upload-expire-access':
      return steer('/control/expire-access', {}, 'every access token of the upload part expired');
    case 'upload-none-yet': {
      const point = await checkpointOf(context);
      return point === null ? check(false, 'the checkpoint could not be read') : judged(judgeNothingYet(point));
    }
    case 'upload-refreshed': {
      const point = await checkpointOf(context);
      return point === null ? check(false, 'the checkpoint could not be read') : judged(judgeRefreshed(point));
    }
    case 'upload-checkpoint': {
      const interruptions = whole(first);
      if (interruptions === null) return check(false, 'upload-checkpoint needs the number of interruptions (upload-checkpoint:4)');
      // the transfer may still be running when the step starts: wait until every registered asset has its object
      const point = await pollUntil(
        context,
        CHECKPOINT_WAIT_MS,
        () => checkpointOf(context),
        (read) => read !== null && Object.keys(read.assets).length > 0 && Object.values(read.assets).every((asset) => asset.objects === 1),
      );
      if (point === null) return check(false, 'the checkpoint could not be read');
      return judged(judgeCheckpoint(point, originalsOnDevice(context, Object.keys(point.assets)), interruptions));
    }
    case 'upload-fault':
    case 'upload-fault-clear': {
      if (first === undefined || first === '') return check(false, `${name} needs the name of a fault`);
      const count = name === 'upload-fault-clear' ? 0 : whole(second);
      return steer(
        '/control/fault',
        { fault: first, ...(count === null ? {} : { count }) },
        `${name === 'upload-fault' ? 'fault' : 'fault cleared:'} ${first}`,
      );
    }
    case 'upload-part-delay': {
      const ms = whole(first);
      return ms === null
        ? check(false, 'upload-part-delay needs milliseconds')
        : steer('/control/part-delay', { ms }, `answer to every part held ${String(ms)} ms`);
    }
    case 'upload-verdict':
      if (first === undefined || first === '') return check(false, 'upload-verdict needs a verdict or none');
      return steer('/control/verdict', { verdict: first === 'none' ? null : first }, `verdict of complete: ${first}`);
    case 'upload-file-state': {
      if (first === undefined || first === '') return check(false, 'upload-file-state needs a state');
      const point = await checkpointOf(context);
      const ids = point === null ? [] : Object.keys(point.assets);
      if (ids.length === 0) return check(false, 'the server registered no asset');
      for (const assetId of ids) {
        const answer = await control(context, 'POST', '/control/file-state', { assetId, state: first });
        if (answer === null || answer.status !== 200)
          return check(false, `the state ${first} was not accepted (HTTP ${String(answer?.status ?? 'none')})`);
      }
      return check(true, `file state ${first} set for ${String(ids.length)} asset(s)`);
    }
    default:
      return check(false, 'unknown upload step');
  }
}
