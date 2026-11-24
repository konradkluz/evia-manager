import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { runDeviceAction } from '../src/device.mjs';
import {
  FORBIDDEN_FILM_ENTRY,
  filmCommands,
  filmCounters,
  isFilmAction,
  judgeFilmControl,
  judgeFilmDisk,
  judgeFilmHeaders,
  judgeFilmManifest,
  runFilmAction,
  takeFilmSnapshot,
} from '../src/device-film.mjs';

const out = (/** @type {string} */ stdout = '', status = 0, stderr = '') => ({ status, stdout, stderr });
const none = out('', 1);
const MD5 = 'b'.repeat(32);

/** @param {Partial<{ container: string[], mark: string[], names: string[], extContainer: string[], extMark: string[], extNames: string[], cache: string[] | null }>} [state] */
function snapshotOf(state = {}) {
  return {
    container: new Set(state.container ?? []),
    mark: new Set(state.mark ?? []),
    names: new Set(state.names ?? []),
    externalContainer: new Set(state.extContainer ?? []),
    externalMark: new Set(state.extMark ?? []),
    externalNames: new Set(state.extNames ?? []),
    cache: { missing: state.cache === null, names: state.cache ?? ['journal'] },
  };
}

/** An adb that answers by what is asked. @param {{ container?: string, mark?: string, names?: string, extContainer?: string, extMark?: string, extNames?: string, external?: boolean, cache?: ReturnType<typeof out>, dump?: ReturnType<typeof out>, plant?: ReturnType<typeof out>, failSearch?: string }} [state] */
function fakeAdb(state = {}) {
  /** @type {string[][]} */
  const calls = [];
  const adb = (/** @type {string[]} */ ...args) => {
    calls.push(args);
    const line = args.join(' ');
    if (state.failSearch !== undefined && line.includes(state.failSearch)) return out('', 2, 'boom');
    if (line.includes('grep') && line.includes('/data/data') && line.includes('ftyp'))
      return state.container === undefined ? none : out(state.container);
    if (line.includes('grep') && line.includes('/data/data') && line.includes('E2EMARK'))
      return state.mark === undefined ? none : out(state.mark);
    if (line.includes('grep') && line.includes('/sdcard') && line.includes('ftyp'))
      return state.extContainer === undefined ? none : out(state.extContainer);
    if (line.includes('grep') && line.includes('/sdcard') && line.includes('E2EMARK'))
      return state.extMark === undefined ? none : out(state.extMark);
    if (line.includes('find') && line.includes('/data/data')) return out(state.names ?? '');
    if (line.includes('find') && line.includes('/sdcard')) return out(state.extNames ?? '');
    if (line.startsWith('shell ls -d')) return state.external === false ? out('', 1, 'No such file or directory') : out('/sdcard/x');
    if (line.includes('ls -1')) return state.cache ?? out('journal\n');
    if (line.includes('printf')) return state.plant ?? out();
    if (line.includes('dumpsys package'))
      return state.dump ?? out(`Package [${APPLICATION_ID}] (abc):\n  requested permissions:\n    android.permission.INTERNET\n`);
    return out();
  };
  return { adb, calls };
}

describe('the film disk search (EVM-143 AC5)', () => {
  it('EVM-143 AC5: the commands search by content (ftyp, the marker) and by name (*.mp4, *.exo, *.m4s) with run-as in the data directory and without it in the external one', () => {
    assert.deepEqual(filmCommands.grepInternal('ftyp'), [
      'shell',
      `run-as ${APPLICATION_ID} grep -r -l -a ftyp /data/data/${APPLICATION_ID}`,
    ]);
    assert.deepEqual(filmCommands.grepExternal('E2EMARK'), ['shell', `grep -r -l -a E2EMARK /sdcard/Android/data/${APPLICATION_ID}`]);
    assert.match(
      String(filmCommands.findInternal()[1]),
      /run-as .* find \/data\/data\/.* -iname '\*\.mp4' -o -iname '\*\.exo' -o -iname '\*\.m4s'/,
    );
    assert.match(String(filmCommands.findExternal()[1]), /^find \/sdcard\/Android\/data\/.* -iname '\*\.mp4'/);
    assert.deepEqual(filmCommands.externalExists(), ['shell', `ls -d /sdcard/Android/data/${APPLICATION_ID}`]);
    assert.match(String(filmCommands.plantControl()[1]), /printf 'xxxxftypisom E2EMARK-FILM' > cache\/E2E-control\.mp4/);
    assert.match(String(filmCommands.removeControl()[1]), /rm -f cache\/E2E-control\.mp4/);
  });

  it('EVM-143 AC5: a snapshot reads the contents, the names and the cache; a failing search makes it null (a search that cannot run proves nothing); a missing external directory is not searched', () => {
    const snapshot = takeFilmSnapshot(
      fakeAdb({ container: '/data/data/x/a\n', names: '/data/data/x/v.mp4\n', cache: out('journal\n') }).adb,
    );
    assert.deepEqual([...(snapshot?.container ?? [])], ['/data/data/x/a']);
    assert.deepEqual([...(snapshot?.names ?? [])], ['/data/data/x/v.mp4']);
    assert.equal(snapshot?.cache.missing, false);
    for (const failing of ['ftyp', 'E2EMARK', 'find /data', 'ls -1']) {
      const state = failing === 'ls -1' ? { cache: out('', 1, 'permission denied') } : { failSearch: failing };
      assert.equal(takeFilmSnapshot(fakeAdb(state).adb), null, failing);
    }
    for (const failing of ['grep -r -l -a ftyp /sdcard', 'grep -r -l -a E2EMARK /sdcard', 'find /sdcard']) {
      assert.equal(takeFilmSnapshot(fakeAdb({ failSearch: failing }).adb), null, failing);
    }
    const noExternal = fakeAdb({ external: false });
    assert.notEqual(takeFilmSnapshot(noExternal.adb), null);
    assert.equal(
      noExternal.calls.some((call) => call.join(' ').includes('/sdcard/Android/data') && !call.join(' ').startsWith('shell ls -d')),
      false,
    );
  });

  it('EVM-143 AC5: no trace = nothing beyond the baseline in the contents, the names, the marker, the external directory, and only the journal in the HTTP cache', () => {
    const baseline = snapshotOf({ container: ['/known'] });
    assert.equal(judgeFilmDisk(baseline, snapshotOf({ container: ['/known'] })).ok, true);
    assert.equal(judgeFilmDisk(baseline, snapshotOf({ container: ['/known'], cache: null })).ok, true);
    assert.match(judgeFilmDisk(baseline, snapshotOf({ container: ['/known'], cache: null })).detail, /no directory/);
    for (const trace of [
      { container: ['/known', '/new'] },
      { container: ['/known'], mark: ['/new'] },
      { container: ['/known'], names: ['/new.mp4'] },
      { container: ['/known'], extContainer: ['/sd/new'] },
      { container: ['/known'], extMark: ['/sd/new'] },
      { container: ['/known'], extNames: ['/sd/new.exo'] },
      { container: ['/known'], cache: ['journal', `${MD5}.0`, `${MD5}.1`] },
      { container: ['/known'], cache: ['journal', 'strange'] },
    ]) {
      const judged = judgeFilmDisk(baseline, snapshotOf(trace));
      assert.equal(judged.ok, false, JSON.stringify(trace));
      assert.match(judged.detail, /TRACE ON THE DISK/);
    }
  });

  it('EVM-143 AC5: the positive control finds the planted file by content, by marker AND by name; a blind search is a failure', () => {
    const baseline = snapshotOf();
    assert.equal(judgeFilmControl(baseline, snapshotOf({ container: ['/c'], mark: ['/c'], names: ['/c.mp4'] })).ok, true);
    for (const blind of [{}, { container: ['/c'], mark: ['/c'] }, { container: ['/c'], names: ['/c'] }, { mark: ['/c'], names: ['/c'] }]) {
      const judged = judgeFilmControl(baseline, snapshotOf(blind));
      assert.equal(judged.ok, false);
      assert.match(judged.detail, /POSITIVE CONTROL FOUND NOTHING/);
    }
  });
});

describe('the film requests and the manifest (EVM-143 AC3 AC5 AC6)', () => {
  const report = (/** @type {Record<string, number>} */ film = {}, urls = {}) => ({
    urls: { videoPreview: 0, ...urls },
    film: {
      requests: 0,
      ranges: 0,
      ok: 0,
      failed: 0,
      authorization: 0,
      cookie: 0,
      cacheBust: 0,
      unknownAddress: 0,
      abandoned: 0,
      bytes: 0,
      ...film,
    },
    videoLoaded: true,
  });

  it('EVM-143 AC3: the counters carry the addresses of the film and its requests', () => {
    assert.deepEqual(filmCounters(report({ requests: 4, ranges: 3, ok: 3, failed: 1, abandoned: 1, bytes: 99 }, { videoPreview: 2 })), {
      urls: 2,
      requests: 4,
      ranges: 3,
      ok: 3,
      failed: 1,
      abandoned: 1,
      bytes: 99,
    });
    assert.equal(filmCounters(/** @type {never} */ ({ urls: {}, film: {} })).urls, 0);
  });

  it('EVM-143 AC3 AC5: the requests carry no Authorization, no Cookie, no cache-buster and only known addresses - and there are some', () => {
    assert.equal(judgeFilmHeaders(report({ requests: 5 })).ok, true);
    assert.equal(judgeFilmHeaders(report()).ok, false);
    assert.match(judgeFilmHeaders(report()).detail, /empty proof/);
    const bad = judgeFilmHeaders(report({ requests: 5, authorization: 1, cookie: 2, cacheBust: 3, unknownAddress: 4 }));
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /1 with Authorization, 2 with Cookie, 3 with a cache-buster _=, 4 to an unknown address/);
    assert.equal(judgeFilmHeaders(/** @type {never} */ ({ film: { requests: 1 } })).ok, true);
  });

  it('EVM-143 AC6: the merged manifest has no foreground service, no microphone, no fullscreen activity and no playback service', () => {
    assert.equal(judgeFilmManifest(fakeAdb().adb('shell', 'dumpsys package')).ok, true);
    assert.equal(judgeFilmManifest(out('', 1)).ok, false);
    assert.match(judgeFilmManifest(out('Package [other]')).detail, /did not describe/);
    for (const entry of [
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.RECORD_AUDIO',
      'expo.modules.video.FullscreenPlayerActivity',
      'expo.modules.video.playbackService.ExpoVideoPlaybackService',
    ]) {
      const judged = judgeFilmManifest(out(`Package [${APPLICATION_ID}] (a):\n  ${entry}\n`));
      assert.equal(judged.ok, false, entry);
      assert.match(judged.detail, /forbidden/);
    }
    // the notification permission of the UPLOAD (EVM-130 AC7) is on the list of the app and is not the player's: the step does not judge it
    assert.equal(
      judgeFilmManifest(
        out(`Package [${APPLICATION_ID}] (a):
  android.permission.POST_NOTIFICATIONS
`),
      ).ok,
      true,
    );
    assert.equal(FORBIDDEN_FILM_ENTRY.test('android.permission.INTERNET'), false);
  });
});

describe('the film steps (EVM-143 AC3-AC6)', () => {
  /** @param {{ answers?: Record<string, { status: number, body: unknown }>, adb?: Parameters<typeof fakeAdb>[0], noControl?: boolean }} [options] */
  function host(options = {}) {
    /** @type {{ method: string, path: string, body?: unknown }[]} */
    const requests = [];
    /** @type {number[]} */
    const sleeps = [];
    const adbState = fakeAdb(options.adb);
    const context = {
      adb: adbState.adb,
      sleep: (/** @type {number} */ ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      memory: new Map(),
      uploadControl: options.noControl
        ? undefined
        : (/** @type {string} */ method, /** @type {string} */ path, /** @type {unknown} */ body) => {
            requests.push({ method, path, body });
            return Promise.resolve(options.answers?.[`${method} ${path}`] ?? { status: 200, body: {} });
          },
    };
    return { context, requests, sleeps, calls: adbState.calls };
  }
  const run = (/** @type {string} */ action, /** @type {ReturnType<typeof host>['context']} */ context) =>
    runFilmAction(/** @type {import('../src/device-film.mjs').FilmAction} */ (action), /** @type {never} */ (context));
  const REPORT = { status: 200, body: { urls: { videoPreview: 1 }, film: { requests: 3, ranges: 2, ok: 3 }, videoLoaded: true } };

  it('EVM-143: the film steps are known to the device dispatcher (and only they)', async () => {
    assert.equal(isFilmAction('film-requests:urls=1'), true);
    assert.equal(isFilmAction('film-disk-check'), true);
    assert.equal(isFilmAction('photos-reset'), false);
    const h = host({ answers: { 'GET /control/photos-report': REPORT } });
    const result = await runDeviceAction('film-headers', /** @type {never} */ (h.context));
    assert.equal(result.ok, true);
    assert.match((await run('film-nonsense', h.context)).detail, /unknown film step/);
  });

  it('EVM-143 AC3: the throttle and the expiry go to the control port with the value of the action name, a refusal is a failure', async () => {
    const h = host();
    assert.equal((await run('film-throttle:250', h.context)).ok, true);
    assert.equal((await run('film-expire:2', h.context)).ok, true);
    assert.deepEqual(
      h.requests.map((request) => [request.path, request.body]),
      [
        ['/control/photos-video-throttle', { ms: 250 }],
        ['/control/photos-video-expire', { count: 2 }],
      ],
    );
    const refused = host({
      answers: {
        'POST /control/photos-video-throttle': { status: 400, body: {} },
        'POST /control/photos-video-expire': { status: 400, body: {} },
      },
    });
    assert.equal((await run('film-throttle:9999', refused.context)).ok, false);
    assert.equal((await run('film-expire:99', refused.context)).ok, false);
    const none = host({ noControl: true });
    assert.equal((await run('film-throttle:1', none.context)).ok, false);
    assert.equal((await run('film-expire:1', none.context)).ok, false);
  });

  it('EVM-143: the fixture step says whether the MP4 of the bucket is loaded', async () => {
    assert.equal((await run('film-fixture', host({ answers: { 'GET /control/photos-report': REPORT } }).context)).ok, true);
    const missing = host({ answers: { 'GET /control/photos-report': { status: 200, body: { ...REPORT.body, videoLoaded: false } } } });
    const judged = await run('film-fixture', missing.context);
    assert.equal(judged.ok, false);
    assert.match(judged.detail, /NO MP4 FIXTURE/);
    assert.equal(
      (await run('film-fixture', host({ answers: { 'GET /control/photos-report': { status: 500, body: {} } } }).context)).ok,
      false,
    );
  });

  it('EVM-143 AC3: the requests are polled until they hold, and fail when they never do or the report cannot be read', async () => {
    const ok = host({ answers: { 'GET /control/photos-report': REPORT } });
    assert.equal((await run('film-requests:urls=1,ranges>=1', ok.context)).ok, true);
    assert.deepEqual(ok.sleeps, []);
    const never = host({ answers: { 'GET /control/photos-report': REPORT } });
    const failed = await run('film-requests:urls=5', never.context);
    assert.equal(failed.ok, false);
    assert.match(failed.detail, /MISMATCH/);
    assert.equal(never.sleeps.length, 19);
    const unreadable = host({ answers: { 'GET /control/photos-report': { status: 500, body: {} } } });
    assert.equal((await run('film-requests:urls=1', unreadable.context)).ok, false);
    assert.equal((await run('film-headers', unreadable.context)).ok, false);
  });

  it('EVM-143 AC5: the baseline needs the searches to run; the check and the control need the baseline', async () => {
    const h = host({ adb: { container: '/known\n' } });
    assert.equal((await run('film-disk-check', h.context)).ok, false);
    assert.equal((await run('film-disk-control', h.context)).ok, false);
    const baseline = await run('film-disk-baseline', h.context);
    assert.equal(baseline.ok, true);
    assert.match(baseline.detail, /baseline: ftyp in 1 file/);
    assert.ok(h.calls.some((call) => call.join(' ') === 'logcat -G 16M'));
    assert.ok(h.calls.some((call) => call.join(' ') === 'logcat -c'));
    assert.equal((await run('film-disk-check', h.context)).ok, true);
    const blind = host({ adb: { failSearch: 'ftyp' } });
    assert.equal((await run('film-disk-baseline', blind.context)).ok, false);
  });

  it('EVM-143 AC5: a trace after the baseline makes the check red; a search that fails makes it red', async () => {
    const h = host({ adb: { container: '/known\n' } });
    await run('film-disk-baseline', h.context);
    const traced = host({ adb: { container: '/known\n/new\n' } });
    traced.context.memory = h.context.memory;
    const judged = await run('film-disk-check', traced.context);
    assert.equal(judged.ok, false);
    assert.match(judged.detail, /TRACE ON THE DISK/);
    const failing = host({ adb: { failSearch: 'find /data' } });
    failing.context.memory = h.context.memory;
    assert.equal((await run('film-disk-check', failing.context)).ok, false);
  });

  it('EVM-143 AC5: the control plants a file, searches, removes it - and fails when the search is blind, the file cannot be planted or the search fails', async () => {
    const seeing = host({ adb: { container: '/c\n', mark: '/c\n', names: '/c.mp4\n' } });
    seeing.context.memory.set('film-baseline', snapshotOf());
    const judged = await run('film-disk-control', seeing.context);
    assert.equal(judged.ok, true);
    const order = seeing.calls.map((call) => call.join(' ')).filter((line) => line.includes('printf') || line.includes('rm -f'));
    assert.equal(order.length, 2);
    assert.match(order[0] ?? '', /printf/);
    assert.match(order[1] ?? '', /rm -f/);
    const blind = host();
    blind.context.memory.set('film-baseline', snapshotOf());
    assert.equal((await run('film-disk-control', blind.context)).ok, false);
    const cannot = host({ adb: { plant: out('', 1, 'run-as: not debuggable') } });
    cannot.context.memory.set('film-baseline', snapshotOf());
    assert.match((await run('film-disk-control', cannot.context)).detail, /could not be planted/);
    const failing = host({ adb: { failSearch: 'grep -r -l -a E2EMARK /data' } });
    failing.context.memory.set('film-baseline', snapshotOf());
    assert.match((await run('film-disk-control', failing.context)).detail, /search of the app directories failed/);
  });

  it('EVM-143 AC6: the manifest step judges dumpsys package', async () => {
    assert.equal((await run('film-manifest', host().context)).ok, true);
    assert.equal(
      (await run('film-manifest', host({ adb: { dump: out(`Package [${APPLICATION_ID}]\n android.permission.RECORD_AUDIO\n`) } }).context))
        .ok,
      false,
    );
  });

  it('EVM-143: a context without a memory still runs the baseline step', async () => {
    const h = host();
    const context = { ...h.context, memory: undefined };
    assert.equal((await run('film-disk-baseline', /** @type {never} */ (context))).ok, true);
  });
});
