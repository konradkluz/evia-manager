import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { runDeviceAction } from '../src/device.mjs';
import {
  CONTROL_LOG_LINE,
  PHOTO_MUST_SHOW,
  PHOTO_VALUES,
  cacheEntries,
  classifyCache,
  countLogLeaks,
  isPhotosAction,
  judgeDisk,
  judgeDiskControl,
  judgeHeaders,
  judgeLog,
  judgeLogControl,
  judgeRequests,
  matchedFiles,
  photosCommands,
  reportCounters,
  runPhotosAction,
  takeSnapshot,
} from '../src/device-photos.mjs';
import { READY_IDS } from '../src/photos-stub.mjs';

const out = (/** @type {string} */ stdout = '', status = 0, stderr = '') => ({ status, stdout, stderr });
const none = out('', 1);
const MD5 = 'a'.repeat(32);

/** @param {Partial<import('../src/device-photos.mjs').Report['images']>} [images] */
const reportOf = (images = {}, urls = {}) => ({
  urls: { thumbnail: 0, preview: 0, original: 0, byAsset: {}, ...urls },
  images: {
    thumbnail: 0,
    preview: 0,
    control: 0,
    total: 0,
    ok: 0,
    failed: 0,
    noStore: 0,
    notNoStore: 0,
    authorization: 0,
    cookie: 0,
    cacheBust: 0,
    unknownAddress: 0,
    abandoned: 0,
    ...images,
  },
  delayMs: 0,
  faults: 0,
});

/** An adb that answers by what is asked. @param {{ webp?: string, mark?: string, extWebp?: string, extMark?: string, external?: boolean, cache?: ReturnType<typeof out>, logcat?: string }} [state] */
function fakeAdb(state = {}) {
  /** @type {string[][]} */
  const calls = [];
  const adb = (/** @type {string[]} */ ...args) => {
    calls.push(args);
    const line = args.join(' ');
    if (line.includes('grep') && line.includes('/data/data') && line.includes('WEBPVP8'))
      return state.webp === undefined ? none : out(state.webp);
    if (line.includes('grep') && line.includes('/data/data') && line.includes('E2EMARK'))
      return state.mark === undefined ? none : out(state.mark);
    if (line.includes('grep') && line.includes('/sdcard') && line.includes('WEBPVP8'))
      return state.extWebp === undefined ? none : out(state.extWebp);
    if (line.includes('grep') && line.includes('/sdcard') && line.includes('E2EMARK'))
      return state.extMark === undefined ? none : out(state.extMark);
    if (line.startsWith('shell ls -d')) return state.external === false ? out('', 1, 'No such file or directory') : out('/sdcard/x');
    if (line.includes('ls -1')) return state.cache ?? out('', 1, 'ls: cache/http-cache: No such file or directory');
    if (args[0] === 'logcat' && args[1] === '-d') return out(state.logcat ?? 'I/System: boot\nD/Other: fine\n');
    return out();
  };
  return { adb, calls };
}

describe('the search and the listings (EVM-142 AC5)', () => {
  it('EVM-142 AC5: grep -l exits 1 and prints nothing when nothing matched, 0 and the names when some did, anything else is a failure of the step', () => {
    assert.deepEqual([...(matchedFiles(none) ?? [])], []);
    assert.deepEqual([...(matchedFiles(out('a\r\nb\n\n')) ?? [])], ['a', 'b']);
    assert.equal(matchedFiles(out('', 2)), null);
    assert.equal(matchedFiles(out('x', 1)), null);
    assert.equal(matchedFiles({ status: null, stdout: '', stderr: '' }), null);
  });

  it('EVM-142 AC5: a missing cache directory holds nothing, any other failure of the listing is a failure', () => {
    assert.deepEqual(cacheEntries(out('', 1, 'ls: cache/http-cache: No such file or directory')), { missing: true, names: [] });
    assert.equal(cacheEntries(out('', 1, 'permission denied')), null);
    assert.deepEqual(cacheEntries(out(`journal\njournal.tmp\n${MD5}.0\n`)), {
      missing: false,
      names: ['journal', 'journal.tmp', `${MD5}.0`],
    });
    assert.deepEqual(classifyCache(['journal', 'journal.bkp', `${MD5}.0`, `${MD5}.1`, 'strange']), { journal: 2, entries: 2, other: 1 });
  });

  it('EVM-142 AC5: the commands search the data directory with run-as and the external one without; fixed text only', () => {
    assert.deepEqual(photosCommands.grepInternal('WEBPVP8'), [
      'shell',
      `run-as ${APPLICATION_ID} grep -r -l -a WEBPVP8 /data/data/${APPLICATION_ID}`,
    ]);
    assert.deepEqual(photosCommands.grepExternal('E2EMARK'), ['shell', `grep -r -l -a E2EMARK /sdcard/Android/data/${APPLICATION_ID}`]);
    assert.deepEqual(photosCommands.listCache(), ['shell', `run-as ${APPLICATION_ID} ls -1 cache/http-cache`]);
    assert.deepEqual(photosCommands.logControl(), ['shell', 'log', '-t', 'E2E', CONTROL_LOG_LINE]);
    assert.deepEqual(photosCommands.logBuffer(), ['logcat', '-G', '16M']);
    assert.deepEqual(photosCommands.logClear(), ['logcat', '-c']);
    assert.deepEqual(photosCommands.externalExists(), ['shell', `ls -d /sdcard/Android/data/${APPLICATION_ID}`]);
  });

  it('EVM-142 AC5: a snapshot reads the four searches and the cache; a failing search makes it null (a search that cannot run proves nothing); a missing external directory is not searched', () => {
    const snapshot = takeSnapshot(fakeAdb({ webp: '/data/data/x/a\n', cache: out('journal\n') }).adb);
    assert.deepEqual(
      [snapshot?.webp.size, snapshot?.mark.size, snapshot?.externalWebp.size, snapshot?.cache.names],
      [1, 0, 0, ['journal']],
    );
    const failing = (/** @type {string[]} */ ...args) =>
      args.join(' ').includes('E2EMARK') && args.join(' ').includes('/sdcard') ? out('', 2) : fakeAdb().adb(...args);
    assert.equal(takeSnapshot(failing), null);
    const noExternal = fakeAdb({ external: false });
    assert.notEqual(takeSnapshot(noExternal.adb), null);
    assert.equal(
      noExternal.calls.some((call) => call.join(' ').includes('/sdcard') && call.join(' ').includes('grep')),
      false,
    );
    assert.equal(
      takeSnapshot(() => out('', 2)),
      null,
    );
  });
});

describe('the judgements of the disk (EVM-142 AC5)', () => {
  const empty = () => takeSnapshot(fakeAdb({ cache: out('journal\n') }).adb);

  it('EVM-142 AC5: nothing beyond the baseline and only the journal in the HTTP cache is a pass', () => {
    const base = /** @type {NonNullable<ReturnType<typeof empty>>} */ (empty());
    const judged = judgeDisk(base, base);
    assert.equal(judged.ok, true);
    assert.match(judged.detail, /^no trace: WEBPVP8 in 0 file\(s\) beyond the baseline/);
    // a file that was in the baseline is not a trace of this run
    const withBase = /** @type {NonNullable<ReturnType<typeof empty>>} */ (
      takeSnapshot(fakeAdb({ webp: '/old\n', cache: out('journal\n') }).adb)
    );
    assert.equal(judgeDisk(withBase, withBase).ok, true);
    // no directory at all is fine too
    assert.equal(
      judgeDisk(base, /** @type {NonNullable<ReturnType<typeof empty>>} */ (takeSnapshot(fakeAdb().adb))).detail.includes('no directory'),
      true,
    );
  });

  it('EVM-142 AC5: a picture, an address, an external file or an entry of the HTTP cache beyond the baseline is a TRACE', () => {
    const base = /** @type {NonNullable<ReturnType<typeof empty>>} */ (empty());
    const cases = [
      { webp: '/data/data/x/cache/a\n', cache: out('journal\n') },
      { mark: '/data/data/x/b\n', cache: out('journal\n') },
      { extWebp: '/sdcard/x/c\n', cache: out('journal\n') },
      { extMark: '/sdcard/x/d\n', cache: out('journal\n') },
      { cache: out(`journal\n${MD5}.0\n${MD5}.1\n`) },
      { cache: out('journal\nsomething-else\n') },
    ];
    for (const state of cases) {
      const now = /** @type {NonNullable<ReturnType<typeof empty>>} */ (takeSnapshot(fakeAdb(state).adb));
      const judged = judgeDisk(base, now);
      assert.equal(judged.ok, false, JSON.stringify(state));
      assert.match(judged.detail, /^TRACE ON THE DISK/);
    }
  });

  it('EVM-142 AC5: the positive control needs the picture, the address and the two entry files of the HTTP cache beyond the baseline - anything less voids the proof', () => {
    const base = /** @type {NonNullable<ReturnType<typeof empty>>} */ (empty());
    const found = /** @type {NonNullable<ReturnType<typeof empty>>} */ (
      takeSnapshot(
        fakeAdb({
          webp: '/data/data/x/cache/http-cache/a.1\n',
          mark: '/data/data/x/cache/http-cache/a.0\n',
          cache: out(`journal\n${MD5}.0\n${MD5}.1\n`),
        }).adb,
      )
    );
    assert.equal(judgeDiskControl(base, found).ok, true);
    assert.match(judgeDiskControl(base, found).detail, /^positive control found the cached picture/);
    for (const state of [
      { cache: out('journal\n') },
      { webp: '/a\n', cache: out(`journal\n${MD5}.0\n${MD5}.1\n`) },
      { webp: '/a\n', mark: '/b\n', cache: out(`journal\n${MD5}.0\n`) },
    ]) {
      const now = /** @type {NonNullable<ReturnType<typeof empty>>} */ (takeSnapshot(fakeAdb(state).adb));
      const judged = judgeDiskControl(base, now);
      assert.equal(judged.ok, false);
      assert.match(judged.detail, /POSITIVE CONTROL FOUND NOTHING/);
    }
  });
});

describe('the judgements of the log (EVM-142 AC5)', () => {
  const clean = 'I/ReactNative: ok\nD/OkHttp: --> GET https://api.example.invalid/health\n';
  it('EVM-142 AC5: an address of the bucket, a signature or the marker in a line of the app is a leak; the lines of the Maestro driver are the harness and stay out', () => {
    assert.deepEqual(countLogLeaks(out(clean)), { total: 2, leaks: 0 });
    assert.equal(judgeLog(out(clean)).ok, true);
    for (const leak of ['http://10.0.2.2:5050/bucket/photos/x', '/bucket/photos/abc', 'X-Amz-Signature=1', 'E2EMARK000001']) {
      const judged = judgeLog(out(`${clean}W/Fetch: ${leak}\n`));
      assert.equal(judged.ok, false, leak);
      assert.match(judged.detail, /1 line\(s\)/);
    }
    assert.equal(judgeLog(out(`${clean}I/Maestro ( 6458): assertVisible E2EMARK http://10.0.2.2:1/bucket\n`)).ok, true);
    assert.equal(countLogLeaks(out('', 1)), null);
    assert.equal(judgeLog(out('', 1)).ok, false);
  });

  it('EVM-142 AC5: an empty log is an empty proof, not a pass', () => {
    const judged = judgeLog(out('\n'));
    assert.equal(judged.ok, false);
    assert.match(judged.detail, /empty proof/);
  });

  it('EVM-142 AC5: the log control must catch the line it wrote; a blind filter or an unreadable log fails', () => {
    assert.equal(judgeLogControl(out(clean), out(`${clean}D/E2E: ${CONTROL_LOG_LINE}\n`)).ok, true);
    assert.equal(judgeLogControl(out(clean), out(clean)).ok, false);
    assert.equal(judgeLogControl(out('', 1), out(clean)).ok, false);
    assert.equal(judgeLogControl(out(clean), out('', 1)).ok, false);
    assert.match(judgeLogControl(out(clean), out(clean)).detail, /FOUND NOTHING/);
  });
});

describe('the judgements of the server counters (EVM-142 AC2, AC3, AC5)', () => {
  it('EVM-142 AC2: the counters get the names the steps use; requests for the photos that are not ready are summed apart', () => {
    const counters = reportCounters(
      reportOf(
        { thumbnail: 3, preview: 2, control: 1, ok: 4, failed: 1, abandoned: 2 },
        { thumbnail: 3, preview: 2, original: 1, byAsset: { [READY_IDS[0] ?? '']: 2, other: 4 } },
      ),
    );
    assert.deepEqual(counters, {
      thumbnailUrls: 3,
      previewUrls: 2,
      originalUrls: 1,
      unreadyUrls: 4,
      thumbnailImages: 3,
      previewImages: 2,
      controlImages: 1,
      okImages: 4,
      failedImages: 1,
      abandoned: 2,
    });
    assert.equal(reportCounters({ ...reportOf(), images: {} }).thumbnailImages, 0);
  });

  it('EVM-142 AC2: every term of an expectation must hold; = is exact and >= a minimum; unknown names and malformed terms fail', () => {
    const counters = { thumbnailUrls: 3, previewUrls: 0 };
    assert.equal(judgeRequests('thumbnailUrls=3,previewUrls=0', counters).ok, true);
    assert.equal(judgeRequests('thumbnailUrls>=2', counters).ok, true);
    const wrong = judgeRequests('thumbnailUrls=2,previewUrls=0', counters);
    assert.equal(wrong.ok, false);
    assert.match(wrong.detail, /thumbnailUrls=3 \(expected =2\) MISMATCH, previewUrls=0 \(expected =0\)$/);
    assert.equal(judgeRequests('thumbnailUrls>=4', counters).ok, false);
    assert.match(judgeRequests('nothing=1', counters).detail, /unknown expectation "nothing=1"/);
    assert.match(judgeRequests('thumbnailUrls', counters).detail, /unknown expectation/);
    assert.match(judgeRequests('', counters).detail, /no expectation/);
  });

  it('EVM-142 AC5: every request of an image had no-store, no Authorization, no Cookie and no cache-buster; a run without a request proves nothing', () => {
    assert.equal(judgeHeaders(reportOf({ thumbnail: 3, preview: 2, noStore: 5 })).ok, true);
    assert.match(judgeHeaders(reportOf({ thumbnail: 3, preview: 2, noStore: 5 })).detail, /all 5 request/);
    assert.match(judgeHeaders(reportOf()).detail, /empty proof/);
    for (const [key, text] of [
      ['notNoStore', 'without no-store'],
      ['authorization', 'with Authorization'],
      ['cookie', 'with Cookie'],
      ['cacheBust', 'cache-buster'],
      ['unknownAddress', 'unknown address'],
    ]) {
      const judged = judgeHeaders(reportOf({ thumbnail: 2, noStore: 2, [String(key)]: 1 }));
      assert.equal(judged.ok, false, String(key));
      assert.match(judged.detail, new RegExp(String(text)));
    }
    const short = judgeHeaders(reportOf({ thumbnail: 2, noStore: 1 }));
    assert.equal(short.ok, false);
    assert.match(short.detail, /only 1 with no-store/);
  });

  it('EVM-142 AC5: the values of the photos screens are the ones the replica shows, and the open preview must show three of them', () => {
    assert.equal(PHOTO_VALUES['description'], 'Opis testowy');
    assert.ok(PHOTO_MUST_SHOW.every((key) => key in PHOTO_VALUES));
  });
});

describe('the steps (EVM-142 AC2-AC5)', () => {
  /** @param {Record<string, { status: number, body: unknown }>} [answers] */
  function host(answers = {}) {
    /** @type {{ method: string, path: string, body?: unknown }[]} */
    const requests = [];
    /** @type {number[]} */
    const sleeps = [];
    const adbState = fakeAdb({ cache: out('journal\n') });
    const context = {
      adb: adbState.adb,
      sleep: (/** @type {number} */ ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      memory: new Map(),
      uploadControl: (/** @type {string} */ method, /** @type {string} */ path, /** @type {unknown} */ body) => {
        requests.push({ method, path, body });
        return Promise.resolve(answers[`${method} ${path}`] ?? { status: 200, body: {} });
      },
    };
    return { context, requests, sleeps, calls: adbState.calls };
  }
  const run = (/** @type {string} */ action, /** @type {ReturnType<typeof host>['context']} */ context) =>
    runPhotosAction(/** @type {import('../src/device-photos.mjs').PhotosAction} */ (action), context);

  it('EVM-142: the photos steps are known to the device dispatcher (and only they)', async () => {
    assert.equal(isPhotosAction('photos-requests:a=1'), true);
    assert.equal(isPhotosAction('photos-headers'), true);
    assert.equal(isPhotosAction('gallery-baseline'), false);
    const h = host();
    const result = await runDeviceAction('photos-reset', /** @type {never} */ (h.context));
    assert.equal(result.ok, true);
    assert.deepEqual(h.requests, [{ method: 'POST', path: '/control/photos-reset', body: undefined }]);
  });

  it('EVM-142: reset, clear, delay and faults go to the control port with the values of the action name', async () => {
    const h = host();
    assert.equal((await run('photos-fault-clear', h.context)).ok, true);
    assert.equal((await run('photos-delay:30000', h.context)).ok, true);
    assert.equal((await run('photos-fault:image:403:1:preview', h.context)).ok, true);
    assert.equal((await run('photos-fault:image:500:0:preview', h.context)).ok, true);
    assert.equal((await run('photos-fault:url:429', h.context)).ok, true);
    assert.deepEqual(
      h.requests.map((request) => [request.path, request.body]),
      [
        ['/control/photos-fault-clear', undefined],
        ['/control/photos-delay', { ms: 30000 }],
        ['/control/photos-fault', { target: 'image', status: 403, count: 1, variant: 'preview' }],
        ['/control/photos-fault', { target: 'image', status: 500, variant: 'preview' }],
        ['/control/photos-fault', { target: 'url', status: 429 }],
      ],
    );
    const refused = host({ 'POST /control/photos-reset': { status: 400, body: {} } });
    assert.equal((await run('photos-reset', refused.context)).ok, false);
    const noPort = { ...host().context, uploadControl: undefined };
    const missing = await run('photos-reset', /** @type {never} */ (noPort));
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /did not answer/);
  });

  it('EVM-142: a wait is bounded and sleeps', async () => {
    const h = host();
    assert.equal((await run('photos-wait:7000', h.context)).ok, true);
    assert.deepEqual(h.sleeps, [7000]);
    assert.equal((await run('photos-wait:abc', h.context)).ok, false);
    assert.equal((await run('photos-wait:999999', h.context)).ok, false);
    assert.equal((await run('photos-nonsense', h.context)).ok, false);
  });

  it('EVM-142 AC2: `photos-requests` polls the counters until they hold and gives up with the last judgement', async () => {
    let reads = 0;
    const h = host();
    h.context.uploadControl = () => {
      reads += 1;
      return Promise.resolve({ status: 200, body: reportOf({ thumbnail: reads >= 3 ? 3 : 1 }, { thumbnail: reads >= 3 ? 3 : 1 }) });
    };
    const passed = await run('photos-requests:thumbnailImages=3', h.context);
    assert.equal(passed.ok, true);
    assert.equal(reads, 3);
    assert.equal(h.sleeps.length, 2);
    const never = host({ 'GET /control/photos-report': { status: 200, body: reportOf({ thumbnail: 1 }) } });
    const failed = await run('photos-requests:thumbnailImages=3', never.context);
    assert.equal(failed.ok, false);
    assert.match(failed.detail, /MISMATCH/);
    const down = host({ 'GET /control/photos-report': { status: 500, body: {} } });
    const unreadable = await run('photos-requests:thumbnailImages=3', down.context);
    assert.equal(unreadable.ok, false);
    assert.match(unreadable.detail, /could not be read/);
  });

  it('EVM-142 AC5: `photos-headers` judges the report of the server', async () => {
    const good = host({ 'GET /control/photos-report': { status: 200, body: reportOf({ thumbnail: 1, noStore: 1 }) } });
    assert.equal((await run('photos-headers', good.context)).ok, true);
    const bad = host({ 'GET /control/photos-report': { status: 200, body: reportOf({ thumbnail: 1, notNoStore: 1 }) } });
    assert.equal((await run('photos-headers', bad.context)).ok, false);
    const down = host({ 'GET /control/photos-report': { status: 500, body: {} } });
    assert.match((await run('photos-headers', down.context)).detail, /could not be read/);
  });

  it('EVM-142 AC5: baseline, then the check; the check without a baseline or with a failing search fails; the baseline clears the log with a big buffer', async () => {
    const h = host();
    const noBaseline = await run('photos-disk-check', h.context);
    assert.equal(noBaseline.ok, false);
    assert.match(noBaseline.detail, /no baseline/);
    const baseline = await run('photos-disk-baseline', h.context);
    assert.equal(baseline.ok, true);
    assert.match(baseline.detail, /log buffer 16M, cleared/);
    assert.deepEqual(h.calls.slice(0, 2), [
      ['logcat', '-G', '16M'],
      ['logcat', '-c'],
    ]);
    assert.equal((await run('photos-disk-check', h.context)).ok, true);
    const broken = { ...h.context, adb: () => out('', 2) };
    assert.equal((await run('photos-disk-check', /** @type {never} */ (broken))).ok, false);
    assert.equal((await run('photos-disk-baseline', /** @type {never} */ (broken))).ok, false);
    assert.equal((await run('photos-control-check', /** @type {never} */ ({ ...h.context, adb: () => out('', 2) }))).ok, false);
    assert.equal((await run('photos-control-check', { ...h.context, memory: new Map() })).ok, false);
  });

  it('EVM-142 AC5: the log step reads the log; the control step needs the cached picture, the line in the log and the request on the server - on the same install', async () => {
    const h = host();
    assert.equal((await run('photos-logcat-clean', h.context)).ok, true);
    await run('photos-disk-baseline', h.context);
    // the install after the control fetch: the picture is in the HTTP cache and the line is in the log once the step wrote it
    let written = false;
    /** @type {(...args: string[]) => ReturnType<typeof out>} */
    const adb = (...args) => {
      if (args[0] === 'shell' && args[1] === 'log') {
        written = true;
        return out();
      }
      if (args[0] === 'logcat' && args[1] === '-d') return out(`I/Sys: fine\n${written ? `D/E2E: ${CONTROL_LOG_LINE}\n` : ''}`);
      return fakeAdb({ webp: '/c/a.1\n', mark: '/c/a.0\n', cache: out(`journal\n${MD5}.0\n${MD5}.1\n`) }).adb(...args);
    };
    const found = host({ 'GET /control/photos-report': { status: 200, body: reportOf({ control: 1 }) } });
    found.context.memory = h.context.memory;
    const good = await run('photos-control-check', { ...found.context, adb });
    assert.equal(good.ok, true);
    assert.match(good.detail, /positive control found the cached picture.*caught the line.*saw the control request/);
    const unseen = host({ 'GET /control/photos-report': { status: 200, body: reportOf() } });
    unseen.context.memory = h.context.memory;
    const missing = await run('photos-control-check', { ...unseen.context, adb });
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /DID NOT SEE/);
    // nothing in the cache = the proof is void
    const nothing = host({ 'GET /control/photos-report': { status: 200, body: reportOf({ control: 1 }) } });
    nothing.context.memory = h.context.memory;
    const voided = await run('photos-control-check', { ...nothing.context, adb: fakeAdb({ cache: out('journal\n') }).adb });
    assert.equal(voided.ok, false);
    assert.match(voided.detail, /POSITIVE CONTROL FOUND NOTHING/);
  });

  describe('the tree of views', () => {
    const node = (/** @type {Record<string, string>} */ attributes) =>
      `<node ${Object.entries({ text: '', 'content-desc': '', 'resource-id': '', package: APPLICATION_ID, ...attributes })
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ')} />`;
    const tree = (/** @type {string[]} */ ...nodes) => `<?xml version='1.0'?><hierarchy rotation="0">${nodes.join('')}</hierarchy>`;
    const adbWith =
      (/** @type {string} */ dump, status = 0) =>
      (/** @type {string[]} */ ...args) =>
        args[1]?.includes('uiautomator dump') ? out(dump, status) : out();

    it('EVM-142 AC5: under the cover none of the values of the photos screens may be in the tree - three reads', async () => {
      const h = host();
      const locked = tree(node({ 'resource-id': 'pl.eviacharge.manager:id/lock-overlay', text: 'Aplikacja zablokowana' }));
      const good = await run('photos-view-tree-locked', { ...h.context, adb: adbWith(locked) });
      assert.equal(good.ok, true);
      assert.match(good.detail, /with the cover, 3 reads: none of the 9 values/);
      assert.equal(h.sleeps.length, 2);
      const leaking = tree(node({ text: 'Aplikacja zablokowana' }), node({ 'content-desc': 'Po zakończeniu, 20.11.2026, 13:30' }));
      const leak = await run('photos-view-tree-locked', { ...h.context, adb: adbWith(leaking) });
      assert.equal(leak.ok, false);
      assert.match(leak.detail, /LEAK under the cover \(sample 1\): category completed_work in content-desc/);
      const noCover = await run('photos-view-tree-locked', { ...h.context, adb: adbWith(tree(node({ text: 'Zdjęcia zlecenia' }))) });
      assert.match(noCover.detail, /not the cover/);
      for (const dump of [adbWith('', 1), adbWith('nothing'), adbWith(tree(node({ package: 'com.other' })))]) {
        const empty = await run('photos-view-tree-locked', { ...h.context, adb: dump });
        assert.equal(empty.ok, false);
        assert.match(empty.detail, /empty or is not the tree of the app/);
      }
    });

    it('EVM-142 AC5: a sample after the first is read a second later (the cover goes on while the app comes back)', async () => {
      const h = host();
      let reads = 0;
      const adb = (/** @type {string[]} */ ...args) => {
        if (!args[1]?.includes('uiautomator dump')) return out();
        reads += 1;
        return out(
          tree(
            node({ text: 'Aplikacja zablokowana' }),
            ...(reads === 3 ? [node({ 'resource-id': 'pl.eviacharge.manager:id/photo-preview' })] : []),
          ),
        );
      };
      const leak = await run('photos-view-tree-locked', { ...h.context, adb });
      assert.equal(leak.ok, false);
      assert.match(leak.detail, /sample 3/);
      assert.deepEqual(h.sleeps, [1000, 1000]);
    });

    it('EVM-142 AC5: the positive control reads the unlocked tree of the open preview and MUST find the category, the description and the id of the preview', async () => {
      const h = host();
      const open = tree(
        node({ text: 'Po zakończeniu' }),
        node({ text: 'Opis testowy completed_work' }),
        node({ 'resource-id': 'pl.eviacharge.manager:id/photo-preview' }),
      );
      const good = await run('photos-view-tree-unlocked', { ...h.context, adb: adbWith(open) });
      assert.equal(good.ok, true);
      assert.match(good.detail, /positive control: the open preview shows category completed_work, description, preview id/);
      const blind = await run('photos-view-tree-unlocked', { ...h.context, adb: adbWith(tree(node({ text: 'Po zakończeniu' }))) });
      assert.equal(blind.ok, false);
      assert.match(blind.detail, /the read is blind/);
      assert.equal((await run('photos-view-tree-unlocked', { ...h.context, adb: adbWith('') })).ok, false);
    });
  });
});
