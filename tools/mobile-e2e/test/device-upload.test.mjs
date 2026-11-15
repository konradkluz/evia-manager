import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isUploadAction,
  judgeCheckpoint,
  judgeFilesGone,
  judgeJobs,
  judgeLogcatSecrets,
  judgeNotification,
  judgeNothingYet,
  judgeRefreshed,
  judgeTokensNotInClear,
  readCheckpoint,
  runUploadAction,
  uploadCommands,
  uploadJobs,
} from '../src/device-upload.mjs';
import { runDeviceAction } from '../src/device.mjs';

const APP = 'pl.eviacharge.manager';
const ASSET = '01900000-0000-7000-8000-000000000002';
const SHA = 'a'.repeat(64);
/** @param {number | null} status @param {string} [stdout] @param {string} [stderr] */
const out = (status, stdout = '', stderr = '') => ({ status, stdout, stderr });

/** @param {Partial<import('../src/device-upload.mjs').AssetPoint>} [asset] @param {Record<string, number>} [counters] */
const point = (asset = {}, counters = {}, extra = {}) => ({
  assets: {
    [ASSET]: { state: 'uploaded', objects: 1, sha256: SHA, declaredSize: 100, sessions: 1, activeParts: 0, partCount: 3, ...asset },
  },
  orphanedMultiparts: 0,
  openMultiparts: 0,
  counters: { partPuts: 5, partsReplaced: 0, refreshes: 0, reuseDetected: 0, ...counters },
  ...extra,
});

/**
 * A fake device and a fake control port: adb answers by the first substring of the joined arguments that matches, every call is recorded.
 * @param {{ adb?: Record<string, ReturnType<typeof out> | ReturnType<typeof out>[]>, control?: (method: string, path: string, body?: unknown) => { status: number, body: unknown } | null }} [setup]
 */
function fake({ adb = {}, control } = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const controlCalls = [];
  const context = {
    adb: (/** @type {string[]} */ ...args) => {
      const line = args.join(' ');
      calls.push(line);
      for (const [needle, answer] of Object.entries(adb)) {
        if (!line.includes(needle)) continue;
        return Array.isArray(answer)
          ? answer.length > 1
            ? /** @type {ReturnType<typeof out>} */ (answer.shift())
            : /** @type {ReturnType<typeof out>} */ (answer[0])
          : answer;
      }
      return out(0);
    },
    sleep: () => Promise.resolve(),
    ...(control === undefined
      ? {}
      : {
          uploadControl: (/** @type {string} */ method, /** @type {string} */ path, /** @type {unknown} */ body) => {
            controlCalls.push(`${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`);
            return Promise.resolve(control(method, path, body));
          },
        }),
  };
  return { context, calls, controlCalls };
}

describe('upload device steps: builders (EVM-130 AC1, AC3, AC5, AC6)', () => {
  it('EVM-130 AC5: the commands read the app through run-as; the only value in a shell string is a checked asset id', () => {
    assert.deepEqual(uploadCommands.logcatClear(), ['logcat', '-c']);
    assert.deepEqual(uploadCommands.dumpsysJobs(), ['shell', 'dumpsys', 'jobscheduler', APP]);
    assert.deepEqual(uploadCommands.listFiles(), ['shell', `run-as ${APP} find no_backup/evia-upload -type f`]);
    assert.deepEqual(uploadCommands.listOriginal(ASSET), ['shell', `run-as ${APP} ls no_backup/evia-upload/originals/${ASSET}`]);
    assert.deepEqual(uploadCommands.digestOriginal(ASSET), ['shell', `run-as ${APP} sha256sum no_backup/evia-upload/originals/${ASSET}`]);
    assert.deepEqual(uploadCommands.grepTokens(), ['shell', `run-as ${APP} grep -r -l -a -E e2e-(access|refresh)- /data/data/${APP}`]);
    assert.deepEqual(uploadCommands.notificationPermission(false), ['shell', 'pm', 'revoke', APP, 'android.permission.POST_NOTIFICATIONS']);
    assert.deepEqual(uploadCommands.notificationPermission(true), ['shell', 'pm', 'grant', APP, 'android.permission.POST_NOTIFICATIONS']);
    // an id that is not a UUID (a shell injection) never reaches a command
    assert.throws(() => uploadCommands.listOriginal('x; rm -rf /'), /not an asset id/);
    assert.throws(() => uploadCommands.digestOriginal('../../etc/passwd'), /not an asset id/);
  });

  it('EVM-130 AC1: the actions with a value are recognised by the part before the colon only', () => {
    for (const action of ['upload-checkpoint:4', 'upload-fault:session_revoked', 'jobs-none', 'logcat-clean', 'upload-verdict:none'])
      assert.equal(isUploadAction(action), true, action);
    for (const action of ['kill-9', 'reboot', 'upload', 'jobs', '']) assert.equal(isUploadAction(action), false, action);
  });
});

describe('upload device steps: judgements (EVM-130 AC1–AC6)', () => {
  it('EVM-130 AC5: logcat holds neither a signed address nor a token word; the lines of the Maestro driver are the harness; counts only', () => {
    assert.equal(judgeLogcatSecrets(out(1)).ok, false);
    const clean = judgeLogcatSecrets(out(0, '11-15 I/EviaUpload( 1): part 3 of 5\nplain line\n'));
    assert.equal(clean.ok, true);
    const dirty = judgeLogcatSecrets(
      out(0, 'D x: GET https://h/p?X-Amz-Signature=abc\nD y: e2e-refresh-up1-----\nD z: e2e-access-1\nok\n'),
    );
    assert.equal(dirty.ok, false);
    assert.equal(dirty.detail, 'logcat: 1 line(s) with X-Amz-, 2 line(s) with a token word');
    assert.doesNotMatch(dirty.detail, /abc|e2e-refresh/);
    // the test driver prints the texts of the views it reads
    assert.equal(judgeLogcatSecrets(out(0, '11-15 12:00:00.000  6458  6470 I Maestro : e2e-access-1 on screen\n')).ok, true);
  });

  it('EVM-130 AC3: a token word in a file of the app data fails (count only); exit 1 without output passes; a failed tool is not a pass', () => {
    assert.equal(judgeTokensNotInClear(out(1)).ok, true);
    const found = judgeTokensNotInClear(out(0, '/data/data/x/no_backup/evia-upload/jobs/a.json\n/data/data/x/files/y\n'));
    assert.equal(found.ok, false);
    assert.equal(found.detail, 'a token of the scenario server is in 2 file(s) of the app data');
    assert.equal(judgeTokensNotInClear(out(2)).ok, false);
    assert.equal(judgeTokensNotInClear(out(1, 'something')).ok, false);
  });

  it('EVM-130 AC1: the jobs of the app are the distinct JOB lines of UploadJobService in dumpsys jobscheduler', () => {
    const dump = [
      'Registered jobs:',
      `  JOB #u0a123/7: 3c1ab ${APP}/pl.eviacharge.upload.android.UploadJobService`,
      '    Requires: network:ANY',
      'Pending queue:',
      `  JOB #u0a123/7: 3c1ab ${APP}/pl.eviacharge.upload.android.UploadJobService`,
      `  JOB #u0a123/9: 4d2cd ${APP}/androidx.work.impl.background.systemjob.SystemJobService`,
    ].join('\n');
    assert.deepEqual(uploadJobs(dump), ['u0a123/7']);
    assert.deepEqual(uploadJobs('nothing'), []);
    assert.equal(judgeJobs(out(0, dump), 'armed').ok, true);
    assert.equal(judgeJobs(out(0, dump), 'none').ok, false);
    assert.equal(judgeJobs(out(0, 'No jobs'), 'none').ok, true);
    assert.equal(judgeJobs(out(0, 'No jobs'), 'armed').ok, false);
    assert.equal(judgeJobs(out(1), 'none').ok, false);
  });

  it('EVM-130 AC5: after the wipe no job file, original or token file is left; the markers may stay; a missing directory is fine; a failed tool is not', () => {
    const root = 'no_backup/evia-upload';
    assert.equal(judgeFilesGone(out(0, `${root}/wipe.marker\n${root}/contact.json\n`)).ok, true);
    assert.equal(judgeFilesGone(out(1, '', `find: ${root}: No such file or directory`)).ok, true);
    assert.equal(judgeFilesGone(out(1, '', 'permission denied')).ok, false);
    const left = judgeFilesGone(out(0, `${root}/jobs/${ASSET}.json\n${root}/originals/${ASSET}\n${root}/token.bin\n`));
    assert.equal(left.ok, false);
    assert.equal(left.detail, '1 job file(s), 1 original(s), 1 token file(s) are still there');
    assert.doesNotMatch(left.detail, new RegExp(ASSET));
  });

  it('EVM-130 AC1: the checkpoint is read leniently; a wrong shape is null', () => {
    assert.equal(readCheckpoint(null), null);
    assert.equal(readCheckpoint('x'), null);
    assert.equal(readCheckpoint({ assets: null, counters: {} }), null);
    assert.equal(readCheckpoint({ assets: {}, counters: null }), null);
    assert.ok(readCheckpoint(point()));
  });

  it('EVM-130 AC1: before the network returns the server has no part, no object and no session (the asset may not even be registered)', () => {
    assert.equal(judgeNothingYet({ assets: {}, orphanedMultiparts: 0, openMultiparts: 0, counters: { partPuts: 0 } }).ok, true);
    assert.equal(judgeNothingYet(point({ objects: 0, sessions: 0 }, { partPuts: 0 })).ok, true);
    assert.equal(judgeNothingYet(point({ objects: 0, sessions: 1 }, { partPuts: 0 })).ok, false);
    assert.equal(judgeNothingYet(point({ objects: 0, sessions: 0 }, { partPuts: 1 })).ok, false);
    assert.equal(judgeNothingYet(point({ objects: 1, sessions: 0 }, { partPuts: 0 })).ok, false);
    assert.equal(judgeNothingYet(point({ objects: 0, sessions: 0 }, { partPuts: 0 }, { openMultiparts: 1 })).ok, false);
    assert.equal(judgeNothingYet({ assets: {}, orphanedMultiparts: 0, openMultiparts: 0, counters: {} }).ok, true);
  });

  it('EVM-130 AC1: one object per asset, SHA-256 equal to the original, no orphaned multipart, parts sent again within the number of interruptions', () => {
    const good = judgeCheckpoint(point({}, { partsReplaced: 2 }), { [ASSET]: SHA }, 4);
    assert.equal(good.ok, true);
    assert.match(good.detail, /1 asset\(s\): exactly one object each.*2 part\(s\) sent again after 4 interruption/);
    assert.equal(judgeCheckpoint({ ...point(), assets: {} }, {}, 4).ok, false);
    assert.match(judgeCheckpoint(point({ objects: 2 }), { [ASSET]: SHA }, 4).detail, /2 object\(s\) of an asset/);
    assert.match(judgeCheckpoint(point({ objects: 0 }), { [ASSET]: SHA }, 4).detail, /0 object\(s\)/);
    assert.match(judgeCheckpoint(point({ sha256: null }), { [ASSET]: SHA }, 4).detail, /without SHA-256/);
    assert.match(judgeCheckpoint(point(), { [ASSET]: 'b'.repeat(64) }, 4).detail, /SHA-256 of the object differs/);
    // the original is gone: only a `clean` server state allows it
    assert.equal(judgeCheckpoint(point({ state: 'clean' }), { [ASSET]: null }, 4).ok, true);
    assert.match(judgeCheckpoint(point(), { [ASSET]: null }, 4).detail, /original is gone but the server state is uploaded/);
    assert.match(judgeCheckpoint(point(), {}, 4).detail, /original is gone/);
    assert.match(judgeCheckpoint(point({}, {}, { orphanedMultiparts: 1 }), { [ASSET]: SHA }, 4).detail, /1 orphaned multipart/);
    assert.match(judgeCheckpoint(point({}, {}, { openMultiparts: 1 }), { [ASSET]: SHA }, 4).detail, /1 open multipart/);
    assert.match(judgeCheckpoint(point({}, { partsReplaced: 5 }), { [ASSET]: SHA }, 4).detail, /5 parts sent again \(at most 4/);
    assert.equal(judgeCheckpoint({ ...point(), counters: {} }, { [ASSET]: SHA }, 0).ok, true);
  });

  it('EVM-130 AC2: the token was refreshed by the app and no reuse ended the family', () => {
    assert.equal(judgeRefreshed(point({}, { refreshes: 2 })).ok, true);
    assert.equal(judgeRefreshed(point({}, { refreshes: 0 })).ok, false);
    assert.match(judgeRefreshed(point({}, { refreshes: 2, reuseDetected: 1 })).detail, /reuse of a refresh token 1 time/);
    assert.equal(judgeRefreshed({ ...point(), counters: {} }).ok, false);
  });

  it('EVM-130 AC6: the notification — low channel, private with a public version, a text of the story, no personal data, no actions', () => {
    const record = (/** @type {string} */ extra = '') =>
      `  NotificationRecord(0x1: pkg=${APP} user=UserHandle{0} id=1 tag=null importance=2 key=0|${APP}|1|null|10123:\n` +
      `    Notification(channel=upload pri=-1 contentView=null vibrate=null sound=null defaults=0x0 flags=0x62 category=progress vis=PRIVATE publicVersion=Notification(channel=upload))\n` +
      `      android.title=String (Wysyłanie 2 z 5 plików)\n${extra}`;
    const channel = (/** @type {string} */ fields = 'mImportance=2, mSound=null, mVibrationEnabled=false, mLockscreenVisibility=0') =>
      `  NotificationChannel{mId='upload', mName=Wysyłanie plików, mDescription=, ${fields}, mBypassDnd=false}\n`;
    const dump = (/** @type {string} */ r, /** @type {string} */ c) => out(0, `Current Notification Manager state:\n${r}\n${c}`);
    assert.equal(judgeNotification(dump(record(), channel())).ok, true);
    assert.equal(judgeNotification(out(1)).ok, false);
    assert.equal(judgeNotification(out(0, 'no records')).detail, 'no notification of the app is posted');
    assert.match(judgeNotification(dump(record().replace('vis=PRIVATE', 'vis=PUBLIC'), channel())).detail, /visibility is not PRIVATE/);
    assert.match(
      judgeNotification(dump(record().replace(' publicVersion=Notification(channel=upload)', ''), channel())).detail,
      /no public version/,
    );
    assert.match(
      judgeNotification(dump(record().replace('Wysyłanie 2 z 5 plików', 'ZL-E2E-1 Testowa 5'), channel())).detail,
      /none of the texts of AC6.*number of an order/,
    );
    assert.match(judgeNotification(dump(record('      actions={\n'), channel())).detail, /action buttons/);
    assert.match(judgeNotification(dump(record(), '')).detail, /channel "Wysyłanie plików" is not in the dump/);
    const loud = judgeNotification(
      dump(record(), channel('mImportance=4, mSound=content://x, mVibrationEnabled=true, mLockscreenVisibility=1')),
    );
    assert.match(loud.detail, /importance of the channel is not LOW; the channel has a sound or a vibration; the channel is not private/);
    // every text of AC6 is accepted
    for (const text of ['Wysłano 12 plików', 'Nie wysłano 2 plików — otwórz aplikację', 'Wysyłanie wstrzymane — zaloguj się w aplikacji'])
      assert.equal(judgeNotification(dump(record().replace('Wysyłanie 2 z 5 plików', text), channel())).ok, true, text);
  });
});

describe('upload device steps: actions (EVM-130 AC1–AC6)', () => {
  it('EVM-130 AC5: logcat is cleared before the scenario and judged after it; the permission is revoked and granted by pm', async () => {
    const device = fake({ adb: { 'logcat -d': out(0, 'fine\n') } });
    assert.equal((await runUploadAction('logcat-clear', device.context)).ok, true);
    assert.equal((await runUploadAction('logcat-clean', device.context)).ok, true);
    assert.equal((await runUploadAction('notifications-revoke', device.context)).detail, 'permission to notify revoked');
    assert.equal((await runUploadAction('notifications-grant', device.context)).detail, 'permission to notify granted');
    assert.deepEqual(device.calls, [
      'logcat -c',
      'logcat -d',
      `shell pm revoke ${APP} android.permission.POST_NOTIFICATIONS`,
      `shell pm grant ${APP} android.permission.POST_NOTIFICATIONS`,
    ]);
    const failing = fake({ adb: { logcat: out(1), pm: out(1) } });
    assert.equal((await runUploadAction('logcat-clear', failing.context)).ok, false);
    assert.equal((await runUploadAction('notifications-grant', failing.context)).ok, false);
  });

  it('EVM-130 AC3 AC5: the token search, the job registry and the files of the module are judged', async () => {
    const jobs = `JOB #u0a1/3: 1 ${APP}/x.UploadJobService`;
    const device = fake({
      adb: { 'grep -r': out(1), jobscheduler: out(0, jobs), 'find no_backup': out(0, 'no_backup/evia-upload/contact.json') },
    });
    assert.equal((await runUploadAction('tokens-not-in-clear', device.context)).ok, true);
    assert.equal((await runUploadAction('jobs-armed', device.context)).ok, true);
    assert.equal((await runUploadAction('jobs-none', device.context)).ok, false);
    assert.equal((await runUploadAction('app-files-none', device.context)).ok, true);
  });

  it('EVM-130 AC1: a job that is registered a moment later is waited for; no job at all after the wait fails', async () => {
    const late = fake({ adb: { jobscheduler: [out(0, 'none'), out(0, 'none'), out(0, `JOB #u0a1/3: 1 ${APP}/x.UploadJobService`)] } });
    assert.equal((await runUploadAction('jobs-armed', late.context)).ok, true);
    assert.equal(late.calls.length, 3);
    const never = fake({ adb: { jobscheduler: out(0, 'none') } });
    assert.equal((await runUploadAction('jobs-armed', never.context)).ok, false);
  });

  it('EVM-130 AC4: the original is present on the device (all of them) or it is gone (waited for); no asset known = failure', async () => {
    const control = () => ({ status: 200, body: point() });
    const present = fake({ control, adb: { 'ls no_backup': out(0, ASSET) } });
    assert.equal((await runUploadAction('original-present', present.context)).ok, true);
    assert.equal((await runUploadAction('original-absent', present.context)).ok, false);
    const gone = fake({ control, adb: { 'ls no_backup': [out(0), out(1, '', 'No such file')] } });
    const waited = await runUploadAction('original-absent', gone.context);
    assert.equal(waited.ok, true);
    assert.equal(waited.detail, '0 of 1 original(s) on the device (expected none)');
    const missing = fake({ control, adb: { 'ls no_backup': out(1) } });
    assert.equal((await runUploadAction('original-present', missing.context)).ok, false);
    const none = fake({ control: () => ({ status: 200, body: { assets: {}, counters: {} } }), adb: {} });
    assert.equal((await runUploadAction('original-present', none.context)).ok, false);
    const unreachable = fake({ control: () => null });
    assert.match((await runUploadAction('original-absent', unreachable.context)).detail, /no asset/);
  });

  it('EVM-130 AC1: the checkpoint waits for the object, compares SHA-256 with the original on the device and counts the interruptions', async () => {
    const started = point({ objects: 0 });
    /** @type {unknown[]} */
    const answers = [started, started, point({}, { partsReplaced: 1 })];
    const control = () => ({ status: 200, body: answers.length > 1 ? answers.shift() : answers[0] });
    const device = fake({ control, adb: { sha256sum: out(0, `${SHA}  no_backup/evia-upload/originals/${ASSET}\n`) } });
    const done = await runUploadAction('upload-checkpoint:4', device.context);
    assert.equal(done.ok, true, done.detail);
    assert.ok(device.calls.some((call) => call.includes('sha256sum')));
    // a different original on the device
    const wrong = fake({ control: () => ({ status: 200, body: point() }), adb: { sha256sum: out(0, `${'c'.repeat(64)}  x\n`) } });
    assert.equal((await runUploadAction('upload-checkpoint:4', wrong.context)).ok, false);
    // no original on the device and the server did not confirm
    const gone = fake({ control: () => ({ status: 200, body: point() }), adb: { sha256sum: out(1) } });
    assert.match((await runUploadAction('upload-checkpoint:0', gone.context)).detail, /original is gone/);
    // an unreadable digest
    const odd = fake({ control: () => ({ status: 200, body: point() }), adb: { sha256sum: out(0, 'not a digest') } });
    assert.equal((await runUploadAction('upload-checkpoint:0', odd.context)).ok, false);
  });

  it('EVM-130 AC1: the checkpoint needs a number, a readable server and an object in the end', async () => {
    const control = () => ({ status: 200, body: point() });
    assert.match((await runUploadAction('upload-checkpoint', fake({ control }).context)).detail, /needs the number of interruptions/);
    assert.match((await runUploadAction('upload-checkpoint:x', fake({ control }).context)).detail, /needs the number/);
    assert.match((await runUploadAction('upload-checkpoint:1', fake({ control: () => null }).context)).detail, /could not be read/);
    assert.match(
      (await runUploadAction('upload-checkpoint:1', fake({ control: () => ({ status: 500, body: null }) }).context)).detail,
      /could not be read/,
    );
    const never = fake({ control: () => ({ status: 200, body: point({ objects: 0 }) }) });
    assert.match((await runUploadAction('upload-checkpoint:1', never.context)).detail, /0 object\(s\)/);
    assert.match(
      (await runUploadAction('upload-checkpoint:1', fake({ control: () => ({ status: 200, body: 'x' }) }).context)).detail,
      /could not be read/,
    );
  });

  it('EVM-130 AC1: nothing-yet, refreshed and the file state use the checkpoint; an unreadable one is a failure', async () => {
    const control = () => ({ status: 200, body: point({ objects: 0, sessions: 0 }, { partPuts: 0, refreshes: 1 }) });
    assert.equal((await runUploadAction('upload-none-yet', fake({ control }).context)).ok, true);
    assert.equal((await runUploadAction('upload-refreshed', fake({ control }).context)).ok, true);
    assert.match((await runUploadAction('upload-none-yet', fake({}).context)).detail, /could not be read/);
    assert.match((await runUploadAction('upload-refreshed', fake({}).context)).detail, /could not be read/);
  });

  it('EVM-130 AC2 AC5: the steering steps post to the control port; a refusal or a silent port is a failure', async () => {
    /** @type {{ status: number, body: unknown }} */
    const ok = { status: 200, body: {} };
    const device = fake({ control: () => ok });
    const cases = [
      ['upload-reset', 'POST /control/reset {}'],
      ['upload-expire-access', 'POST /control/expire-access {}'],
      ['upload-fault:session_revoked', 'POST /control/fault {"fault":"session_revoked"}'],
      ['upload-fault:expired_url:2', 'POST /control/fault {"fault":"expired_url","count":2}'],
      ['upload-fault-clear:session_revoked', 'POST /control/fault {"fault":"session_revoked","count":0}'],
      ['upload-part-delay:4000', 'POST /control/part-delay {"ms":4000}'],
      ['upload-verdict:quarantined', 'POST /control/verdict {"verdict":"quarantined"}'],
      ['upload-verdict:none', 'POST /control/verdict {"verdict":null}'],
    ];
    for (const [action, call] of cases) {
      const result = await runUploadAction(/** @type {string} */ (action), device.context);
      assert.equal(result.ok, true, String(action));
      assert.equal(device.controlCalls.at(-1), call);
    }
    const refused = fake({ control: () => ({ status: 400, body: {} }) });
    assert.equal((await runUploadAction('upload-reset', refused.context)).ok, false);
    const silent = fake({ control: () => null });
    assert.match((await runUploadAction('upload-reset', silent.context)).detail, /did not answer/);
    const noChannel = fake({});
    assert.match((await runUploadAction('upload-expire-access', noChannel.context)).detail, /did not answer/);
    const thrown = { adb: () => out(0), sleep: () => Promise.resolve(), uploadControl: () => Promise.reject(new Error('refused')) };
    assert.match((await runUploadAction('upload-reset', thrown)).detail, /did not answer/);
  });

  it('EVM-130 AC1: the steering steps refuse a missing value', async () => {
    const device = fake({ control: () => ({ status: 200, body: {} }) });
    for (const action of [
      'upload-fault',
      'upload-fault:',
      'upload-fault-clear',
      'upload-part-delay',
      'upload-part-delay:-1',
      'upload-verdict',
      'upload-verdict:',
      'upload-file-state',
      'upload-file-state:',
    ])
      assert.equal((await runUploadAction(action, device.context)).ok, false, action);
    assert.deepEqual(device.controlCalls, []);
    assert.equal((await runUploadAction('nothing', device.context)).detail, 'unknown upload step');
  });

  it('EVM-130 AC4: the file state is set for every asset of the server', async () => {
    const calls = /** @type {string[]} */ ([]);
    const control = (/** @type {string} */ method, /** @type {string} */ path, /** @type {unknown} */ body) => {
      calls.push(`${method} ${path} ${JSON.stringify(body)}`);
      return method === 'GET' ? { status: 200, body: point() } : { status: 200, body: {} };
    };
    const device = fake({ control });
    assert.equal((await runUploadAction('upload-file-state:clean', device.context)).detail, 'file state clean set for 1 asset(s)');
    assert.deepEqual(calls.at(-1), `POST /control/file-state {"assetId":"${ASSET}","state":"clean"}`);
    const rejecting = fake({ control: (method) => (method === 'GET' ? { status: 200, body: point() } : { status: 400, body: {} }) });
    assert.match((await runUploadAction('upload-file-state:lost', rejecting.context)).detail, /HTTP 400/);
    const silent = fake({ control: (method) => (method === 'GET' ? { status: 200, body: point() } : null) });
    assert.match((await runUploadAction('upload-file-state:clean', silent.context)).detail, /HTTP none/);
    const empty = fake({ control: () => ({ status: 200, body: { assets: {}, counters: {} } }) });
    assert.match((await runUploadAction('upload-file-state:clean', empty.context)).detail, /no asset/);
  });

  it('EVM-130 AC6: the notification of the app is read from dumpsys', async () => {
    const device = fake({ adb: { 'dumpsys notification': out(0, 'nothing') } });
    assert.equal((await runUploadAction('notification-private', device.context)).ok, false);
  });

  it('EVM-130 AC1: runDeviceAction hands the upload steps over and keeps the local ones', async () => {
    const device = fake({ adb: { 'logcat -c': out(0) } });
    const context = {
      ...device.context,
      startAdb: () => undefined,
      readBytes: () => null,
      removeFile: () => undefined,
      backupFile: 'b',
      releaseApk: 'r',
      e2eApk: 'e',
    };
    const upload = await runDeviceAction('logcat-clear', context);
    assert.deepEqual(upload, { action: 'logcat-clear', ok: true, detail: 'logcat buffer cleared' });
    const local = await runDeviceAction('force-stop', context);
    assert.equal(local.action, 'force-stop');
    assert.ok(device.calls.some((call) => call.includes('force-stop')));
  });
});
