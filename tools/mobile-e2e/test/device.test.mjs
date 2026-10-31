import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  BACKUP_CONTROL_PACKAGE,
  backupEntries,
  currentTransport,
  DATABASE,
  deviceCommands,
  backupLogLine,
  installedApkPath,
  judgeAdbBackup,
  judgeAdbBackupControl,
  judgeBackupTransport,
  judgeDebuggable,
  judgeInstall,
  judgeRunAsRefused,
  judgeGrep,
  judgeHeader,
  judgeLogcat,
  LOCAL_TRANSPORT,
  runDeviceAction,
  SENTINEL,
} from '../src/device.mjs';

const APP = 'pl.eviacharge.manager';
/** @param {number | null} status @param {string} [stdout] */
const out = (status, stdout = '') => ({ status, stdout, stderr: '' });
const HEADER_HEX = ' 8a 11 52 c0 9d 3e 77 01 aa 5b 42 19 e0 33 6c 0f\n';
const PLAIN_HEX = ` ${[...Buffer.from('SQLite format 3\0', 'latin1')].map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n`;

/**
 * A tar entry header (ustar, 512 bytes) followed by its content padded to 512.
 * @param {string} name @param {string} [content] @param {string} [prefix]
 */
function tarEntry(name, content = '', prefix = '') {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'latin1');
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'latin1');
  header.write('ustar', 257, 'latin1');
  if (prefix !== '') header.write(prefix, 345, 'latin1');
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  body.write(content, 0, 'latin1');
  return Buffer.concat([header, body]);
}
/** @param {Buffer[]} entries @param {{ compressed?: boolean, encryption?: string }} [options] */
function archive(entries, { compressed = true, encryption = 'none' } = {}) {
  const tar = Buffer.concat([...entries, Buffer.alloc(1024)]);
  return Buffer.concat([Buffer.from(`ANDROID BACKUP\n5\n${compressed ? '1' : '0'}\n${encryption}\n`), compressed ? deflateSync(tar) : tar]);
}

describe('device steps of the local-store scenarios (EVM-093 AC1, AC3–AC7)', () => {
  it('EVM-093 AC1: the sentinel is composed at run time and the commands read the app directory through run-as only', () => {
    assert.equal(SENTINEL, 'EVM093-SENTINEL');
    assert.equal(DATABASE, 'files/SQLite/evia.db');
    assert.deepEqual(deviceCommands.header(), ['shell', `run-as ${APP} od -A n -t x1 -N 16 files/SQLite/evia.db`]);
    assert.deepEqual(deviceCommands.size(), ['shell', `run-as ${APP} stat -c %s files/SQLite/evia.db`]);
    // the whole data directory: files/ (SQLite with -wal/-shm), databases/, shared_prefs/, cache/, code_cache/, no_backup/
    assert.deepEqual(deviceCommands.grepAppData(), ['shell', `run-as ${APP} grep -r -l -a EVM093-SENTINEL /data/data/${APP}`]);
    assert.deepEqual(deviceCommands.grepExternal(), ['shell', `grep -r -l -a EVM093-SENTINEL /sdcard/Android/data/${APP}`]);
    assert.deepEqual(deviceCommands.externalExists(), ['shell', `ls -d /sdcard/Android/data/${APP}`]);
    assert.deepEqual(deviceCommands.logcat(), ['logcat', '-d']);
  });

  it('EVM-093 AC3: force-stop, kill -9 with the uid of the app (no root on a Google Play image) and the restart of the emulator', () => {
    assert.deepEqual(deviceCommands.forceStop(), ['shell', 'am', 'force-stop', APP]);
    assert.deepEqual(deviceCommands.kill9(), ['shell', `run-as ${APP} kill -9 $(pidof ${APP})`]);
    assert.deepEqual(deviceCommands.reboot(), ['reboot']);
    assert.deepEqual(deviceCommands.waitForDevice(), ['wait-for-device']);
    assert.deepEqual(deviceCommands.bootCompleted(), ['shell', 'getprop', 'sys.boot_completed']);
  });

  it('EVM-093 AC5, AC6: the copy takes the log with the file; the damage zeroes page 1 and removes the log (no newer page 1)', () => {
    const [, copy] = deviceCommands.copyDatabase();
    assert.match(copy ?? '', /^run-as pl\.eviacharge\.manager sh -c 'cd files\/SQLite && cp evia\.db evia-copy\.db && /);
    assert.match(copy ?? '', /cp evia\.db-wal evia-copy\.db-wal/);
    const [, damage] = deviceCommands.corruptDatabase();
    assert.match(damage ?? '', /dd if=\/dev\/zero of=evia\.db bs=4096 count=1 conv=notrunc && rm -f evia\.db-wal evia\.db-shm'$/);
  });

  it('EVM-093 AC4: bmgr and adb backup commands', () => {
    assert.deepEqual(deviceCommands.bmgrTransport(LOCAL_TRANSPORT), [
      'shell',
      'bmgr',
      'transport',
      'com.android.localtransport/.LocalTransport',
    ]);
    assert.deepEqual(deviceCommands.bmgrBackupNow(APP), ['shell', 'bmgr', 'backupnow', APP]);
    assert.deepEqual(deviceCommands.bmgrEnabled(), ['shell', 'bmgr', 'enabled']);
    assert.deepEqual(deviceCommands.bmgrEnable(), ['shell', 'bmgr', 'enable', 'true']);
    assert.deepEqual(deviceCommands.bmgrTransports(), ['shell', 'bmgr', 'list', 'transports']);
    assert.deepEqual(deviceCommands.adbBackup('/r/.scratch/b.ab'), ['backup', '-f', '/r/.scratch/b.ab', '-noapk', APP]);
  });

  it('EVM-093 AC1: the header check passes an encrypted file only — a plain, missing, empty or unreadable file fails', () => {
    assert.equal(judgeHeader(out(0, HEADER_HEX), out(0, '32768\n')).ok, true);
    assert.deepEqual(judgeHeader(out(0, PLAIN_HEX), out(0, '32768')), {
      ok: false,
      detail: 'the database file starts with the plain SQLite header',
    });
    assert.match(judgeHeader(out(0, HEADER_HEX), out(0, '0')).detail, /0 bytes .*empty/);
    assert.match(judgeHeader(out(0, HEADER_HEX), out(1, '')).detail, /not readable through run-as/);
    assert.match(judgeHeader(out(1, ''), out(0, '8192')).detail, /header .* not readable/);
    assert.match(judgeHeader(out(0, ' 8a 11'), out(0, '8192')).detail, /header .* not readable/);
  });

  it('EVM-093 AC1: grep: exit 1 without output is a pass, a match is a failure with a count only, any other exit is a failure', () => {
    assert.equal(judgeGrep(out(1), 'x').ok, true);
    assert.deepEqual(judgeGrep(out(0, `/data/data/${APP}/files/a\n/data/data/${APP}/files/b\n`), 'the app'), {
      ok: false,
      detail: 'the sentinel is in 2 file(s) of the app',
    });
    assert.deepEqual(judgeGrep(out(2, ''), 'the app'), { ok: false, detail: 'grep over the app failed (exit 2)' });
    assert.equal(judgeGrep(out(1, 'noise'), 'x').ok, false);
  });

  it('EVM-093 AC1: logcat must not carry the sentinel (the count only) and must be readable', () => {
    assert.equal(judgeLogcat(out(0, 'I/app: started\n')).ok, true);
    assert.deepEqual(judgeLogcat(out(0, `I/x: ${SENTINEL} 1\nI/y: ok\n`)), { ok: false, detail: '1 logcat line(s) carry the sentinel' });
    assert.equal(judgeLogcat(out(1)).ok, false);
  });

  it('EVM-093 AC4: Auto Backup: the control package must be backed up by the transport, and the app must be refused', () => {
    const control = out(0, `Package @pm@ with result: Success\nPackage ${BACKUP_CONTROL_PACKAGE} with result: Success\n`);
    const refused = out(0, `Package ${APP} with result: Backup is not allowed\n`);
    assert.equal(judgeBackupTransport(refused, control).ok, true);
    assert.equal(judgeBackupTransport(out(0, `Package ${APP} not eligible for backup\n`), control).ok, true);
    // the transport did not work: no proof
    assert.match(
      judgeBackupTransport(refused, out(0, `Package ${BACKUP_CONTROL_PACKAGE} with result: Transport error\n`)).detail,
      /did not back up/,
    );
    assert.match(judgeBackupTransport(refused, out(1, '')).detail, /did not back up/);
    assert.match(judgeBackupTransport(out(0, `Package ${APP} with result: Success\n`), control).detail, /WAS backed up/);
    assert.match(judgeBackupTransport(out(0, 'Running incremental backup\n'), control).detail, /unexpected answer/);
    assert.match(judgeBackupTransport(out(255, ''), control).detail, /failed \(exit 255\)/);
  });

  it('EVM-093 AC4: the selected transport is the one marked with an asterisk', () => {
    assert.equal(
      currentTransport(`    ${LOCAL_TRANSPORT}\n  * com.google.android.gms/.backup.BackupTransportService\n`),
      'com.google.android.gms/.backup.BackupTransportService',
    );
    assert.equal(currentTransport('none'), undefined);
  });

  it('EVM-093 AC4: the archive entries are read from a deflated or plain tar, with the ustar prefix', () => {
    const entries = [tarEntry('apps/x/_manifest', 'm'), tarEntry('evia.db', 'data', `apps/${APP}/f/SQLite`)];
    assert.deepEqual(backupEntries(archive(entries)), ['apps/x/_manifest', `apps/${APP}/f/SQLite/evia.db`]);
    assert.deepEqual(backupEntries(archive(entries, { compressed: false })), ['apps/x/_manifest', `apps/${APP}/f/SQLite/evia.db`]);
    assert.equal(backupEntries(archive(entries, { encryption: 'AES-256' })), null);
    assert.equal(backupEntries(Buffer.from('ANDROID BACKUP\n5\n')), null);
    assert.equal(backupEntries(Buffer.from('PK\u0003\u0004 zip\n1\n2\n3\n')), null);
    assert.equal(backupEntries(Buffer.concat([Buffer.from('ANDROID BACKUP\n5\n1\nnone\n'), Buffer.from('not deflate')])), null);
    assert.deepEqual(backupEntries(Buffer.from('ANDROID BACKUP\n5\n1\nnone\n')), []);
  });

  it('EVM-093 AC4: adb backup: no entry of the app data (database, key check value, secure store, no_backup) may be in the archive', () => {
    assert.match(judgeAdbBackup(archive([])).detail, /none from the app data/);
    assert.equal(judgeAdbBackup(archive([tarEntry(`apps/${APP}/_manifest`, 'm')])).ok, true);
    const leaked = archive([
      tarEntry(`apps/${APP}/f/SQLite/evia.db`, 'x'),
      tarEntry(`apps/${APP}/f/evia-database-key-check`, 'x'),
      tarEntry(`apps/${APP}/sp/SecureStore.xml`, 'x'),
    ]);
    assert.deepEqual(judgeAdbBackup(leaked), { ok: false, detail: '3 entries of the app data in the archive (domains: f, sp)' });
    assert.match(judgeAdbBackup(null).detail, /no archive/);
    assert.match(judgeAdbBackup(Buffer.alloc(0)).detail, /no archive/);
    assert.match(judgeAdbBackup(Buffer.from('garbage')).detail, /not a readable adb backup/);
  });
});

/**
 * A fake device for runDeviceAction: answers by the joined arguments (first match of a substring), records every call.
 * @param {[string, { status: number | null, stdout: string, stderr: string } | (() => { status: number | null, stdout: string, stderr: string })][]} answers
 * @param {{ archive?: Buffer | null, files?: Record<string, Buffer> }} [options]
 */
function fakeDevice(answers, { archive: bytes = null, files = {} } = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const started = [];
  /** @type {string[]} */
  const removed = [];
  const context = /** @type {import('../src/device.mjs').DeviceContext} */ ({
    adb: (...args) => {
      const joined = args.join(' ');
      calls.push(joined);
      const found = answers.find(([part]) => joined.includes(part));
      if (found === undefined) return out(0);
      return typeof found[1] === 'function' ? found[1]() : found[1];
    },
    startAdb: (...args) => {
      started.push(args.join(' '));
    },
    sleep: () => Promise.resolve(),
    readBytes: (path) => files[path] ?? (path.endsWith('.ab') ? bytes : null),
    removeFile: (path) => {
      removed.push(path);
    },
    backupFile: '/r/.scratch/mobile-e2e/evm093-backup.ab',
    releaseApk: RELEASE_APK,
    e2eApk: E2E_APK,
  });
  return { context, calls, started, removed };
}

const RELEASE_APK = '/r/.scratch/mobile-e2e/evm093-release-debugkey.apk';
const E2E_APK = '/r/apps/mobile/android/app/build/outputs/apk/release/app-release.apk';
const RELEASE_BYTES = Buffer.from('synthetic release package');
const RELEASE_SHA = createHash('sha256').update(RELEASE_BYTES).digest('hex');
const BASE_APK = `/data/app/~~Qx1_a-b==/${APP}-Zy9==/base.apk`;
/** dumpsys package of the app: `flags=[ … ]` of the package section (`pkgFlags=[ … ]` on older releases) @param {string} flags */
const dumpsys = (flags) =>
  out(
    0,
    `Packages:\n  Package [${APP}] (1a2b3c):\n    versionCode=1\n    flags=[ ${flags} ]\n    privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE ]\n`,
  );
/** @type {[string, { status: number | null, stdout: string, stderr: string }][]} */
const RELEASE_DEVICE = [
  ['install -r', out(0, 'Performing Streamed Install\nSuccess\n')],
  ['dumpsys package', dumpsys('HAS_CODE ALLOW_CLEAR_USER_DATA')],
  ['run-as', { status: 1, stdout: '', stderr: `run-as: package not debuggable: ${APP}\n` }],
  ['pm path', out(0, `package:${BASE_APK}\n`)],
  ['sha256sum', out(0, `${RELEASE_SHA}  ${BASE_APK}\n`)],
];

describe('the AC4 release package on the device (EVM-093 AC4, security controls 1, 2, 4, 6)', () => {
  it('EVM-093 AC4: install, dumpsys, run-as, pm path and sha256sum commands', () => {
    assert.deepEqual(deviceCommands.install(RELEASE_APK), ['install', '-r', RELEASE_APK]);
    assert.deepEqual(deviceCommands.dumpsysPackage(), ['shell', 'dumpsys', 'package', APP]);
    assert.deepEqual(deviceCommands.runAsProbe(), ['shell', 'run-as', APP, 'id']);
    assert.deepEqual(deviceCommands.packagePath(), ['shell', 'pm', 'path', APP]);
    assert.deepEqual(deviceCommands.sha256sum(BASE_APK), ['shell', 'sha256sum', BASE_APK]);
  });

  it('EVM-093 AC4: an install passes only with exit 0 and "Success"', () => {
    assert.equal(judgeInstall(out(0, 'Performing Streamed Install\nSuccess\n')).ok, true);
    assert.equal(judgeInstall(out(1, 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')).ok, false);
    assert.equal(judgeInstall(out(0, 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]')).ok, false);
  });

  it('EVM-093 AC4: dumpsys: not debuggable means a flags line without DEBUGGABLE (and without ALLOW_BACKUP); no flags line is a failure', () => {
    assert.equal(judgeDebuggable(dumpsys('HAS_CODE ALLOW_CLEAR_USER_DATA'), false).ok, true);
    assert.match(judgeDebuggable(dumpsys('DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA'), false).detail, /DEBUGGABLE/);
    assert.match(judgeDebuggable(dumpsys('HAS_CODE ALLOW_BACKUP'), false).detail, /ALLOW_BACKUP/);
    // older releases print pkgFlags; privateFlags never counts as the flags line
    assert.equal(judgeDebuggable(out(0, `  Package [${APP}] (1):\n    pkgFlags=[ HAS_CODE ]\n`), false).ok, true);
    assert.match(judgeDebuggable(out(0, `  Package [${APP}] (1):\n    privateFlags=[ X ]\n`), false).detail, /no flags line/);
    assert.match(judgeDebuggable(out(0, 'Unable to find package: x\n    flags=[ HAS_CODE ]\n'), false).detail, /not installed/);
    assert.match(judgeDebuggable(out(1, ''), false).detail, /dumpsys/);
    // the e2e package back on the device is debuggable again (run-as of the next scenarios)
    assert.equal(judgeDebuggable(dumpsys('DEBUGGABLE HAS_CODE'), true).ok, true);
    assert.equal(judgeDebuggable(dumpsys('HAS_CODE'), true).ok, false);
  });

  it('EVM-093 AC4: run-as must be refused because the package is not debuggable; a working run-as or another error fails', () => {
    assert.equal(judgeRunAsRefused({ status: 1, stdout: '', stderr: `run-as: package not debuggable: ${APP}\n` }).ok, true);
    assert.match(judgeRunAsRefused(out(0, 'uid=10190(u0_a190)')).detail, /run-as works/);
    assert.match(judgeRunAsRefused({ status: 1, stdout: '', stderr: 'run-as: unknown package' }).detail, /another reason/);
  });

  it('EVM-093 AC4: the installed base.apk path is taken from pm path only when it is a plain /data/app path', () => {
    assert.equal(installedApkPath(out(0, `package:${BASE_APK}\n`)), BASE_APK);
    assert.equal(installedApkPath(out(0, 'package:/data/app/x;rm -rf y/base.apk\n')), null);
    assert.equal(installedApkPath(out(0, `package:${BASE_APK}\npackage:/data/app/a/split_config.apk\n`)), BASE_APK);
    assert.equal(installedApkPath(out(1, '')), null);
  });

  it('EVM-093 AC4: only the logcat line about the backup of the app is kept (tag and message, no other line)', () => {
    const logcat = [
      '10-31 10:00:00.000  100  200 I ActivityManager: Start proc 4242:com.other/u0a1',
      `10-31 10:00:01.000  100  201 W BackupManagerService: Package ${APP} is not eligible for backup, removing.`,
      '10-31 10:00:02.000  100  202 I app: token=abc',
    ].join('\n');
    assert.equal(backupLogLine(out(0, logcat)), `BackupManagerService: Package ${APP} is not eligible for backup, removing.`);
    assert.equal(backupLogLine(out(0, `${APP} is not eligible\n`)), `${APP} is not eligible`);
    assert.equal(backupLogLine(out(0, 'nothing\n')), null);
    assert.equal(backupLogLine(out(1, '')), null);
  });

  it('EVM-093 AC4: install-release-debugkey passes for a not debuggable package whose base.apk is the built file', async () => {
    const device = fakeDevice(RELEASE_DEVICE, { files: { [RELEASE_APK]: RELEASE_BYTES } });
    const result = await runDeviceAction('install-release-debugkey', device.context);
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, new RegExp(`SHA-256 ${RELEASE_SHA}`));
    assert.equal(device.calls[0], `install -r ${RELEASE_APK}`);
  });

  it('EVM-093 AC4: install-release-debugkey fails on a failed install, DEBUGGABLE, no flags line, a working run-as or another base.apk', async () => {
    /** @param {[string, { status: number | null, stdout: string, stderr: string }][]} overrides */
    const run = async (overrides) =>
      runDeviceAction(
        'install-release-debugkey',
        fakeDevice([...overrides, ...RELEASE_DEVICE], { files: { [RELEASE_APK]: RELEASE_BYTES } }).context,
      );
    /** @type {[string, [string, { status: number | null, stdout: string, stderr: string }][]][]} */
    const cases = [
      ['install failed', [['install -r', out(1, 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]')]]],
      ['debuggable', [['dumpsys package', dumpsys('DEBUGGABLE HAS_CODE')]]],
      ['no flags line', [['dumpsys package', out(0, `  Package [${APP}] (1):\n`)]]],
      ['run-as works', [['run-as', out(0, 'uid=10190')]]],
      ['other apk', [['sha256sum', out(0, `${'0'.repeat(64)}  ${BASE_APK}\n`)]]],
      ['sha256sum failed', [['sha256sum', out(1, '')]]],
      ['no base.apk', [['pm path', out(0, '')]]],
    ];
    for (const [name, overrides] of cases) assert.equal((await run(overrides)).ok, false, name);
    const noLocal = await runDeviceAction('install-release-debugkey', fakeDevice(RELEASE_DEVICE).context);
    assert.equal(noLocal.ok, false);
  });

  it('EVM-093 AC4: reinstall-e2e installs the e2e package again and passes only when it is debuggable again', async () => {
    const back = fakeDevice([
      ['install -r', out(0, 'Success\n')],
      ['dumpsys package', dumpsys('DEBUGGABLE HAS_CODE')],
    ]);
    assert.equal((await runDeviceAction('reinstall-e2e', back.context)).ok, true);
    assert.equal(back.calls[0], `install -r ${E2E_APK}`);
    assert.equal((await runDeviceAction('reinstall-e2e', fakeDevice([['install -r', out(1, 'Failure')]]).context)).ok, false);
    const notBack = fakeDevice([
      ['install -r', out(0, 'Success\n')],
      ['dumpsys package', dumpsys('HAS_CODE')],
    ]);
    assert.equal((await runDeviceAction('reinstall-e2e', notBack.context)).ok, false);
  });

  it('EVM-093 AC4: positive control on the debuggable e2e build: the archive MUST hold app data, otherwise the transport proves nothing', () => {
    const withData = archive([tarEntry(`apps/${APP}/f/SQLite/evia.db`, 'x'), tarEntry(`apps/${APP}/sp/SecureStore.xml`, 'x')]);
    const control = judgeAdbBackupControl(withData);
    assert.equal(control.ok, true, control.detail);
    assert.match(control.detail, /2 entries of the app data \(domains: f, sp\)/);
    assert.match(judgeAdbBackupControl(archive([tarEntry(`apps/${APP}/_manifest`, 'm')])).detail, /no entry of the app data/);
    assert.match(judgeAdbBackupControl(null).detail, /no archive/);
    assert.match(judgeAdbBackupControl(Buffer.from('garbage')).detail, /not a readable adb backup/);
  });

  it('EVM-093 AC4: the release backup check keeps the logcat line of the refusal in its detail; the control check removes its archive', async () => {
    const line = `10-31 10:00:01.000  100  201 W BackupManagerService: Package ${APP} is not eligible for backup, removing.`;
    const release = fakeDevice([['logcat', out(0, `${line}\n`)]], { archive: archive([]) });
    const result = await runDeviceAction('adb-backup-check', release.context);
    assert.equal(result.ok, true, result.detail);
    assert.match(result.detail, /logcat: "BackupManagerService: Package pl\.eviacharge\.manager is not eligible for backup, removing\."/);
    const silent = await runDeviceAction('adb-backup-check', fakeDevice([], { archive: archive([]) }).context);
    assert.match(silent.detail, /logcat: no line about the backup of the app/);
    const withData = archive([tarEntry(`apps/${APP}/f/SQLite/evia.db`, 'x')]);
    const control = fakeDevice([], { archive: withData });
    assert.equal((await runDeviceAction('adb-backup-control-check', control.context)).ok, true);
    assert.deepEqual(control.removed, ['/r/.scratch/mobile-e2e/evm093-backup.ab']);
  });
});

describe('running the device steps (EVM-093 AC1, AC3–AC6)', () => {
  it('EVM-093 AC3: force-stop and the damage of the file report the outcome of adb', async () => {
    assert.deepEqual(await runDeviceAction('force-stop', fakeDevice([]).context), {
      action: 'force-stop',
      ok: true,
      detail: 'am force-stop',
    });
    assert.equal((await runDeviceAction('force-stop', fakeDevice([['force-stop', out(1)]]).context)).ok, false);
    assert.equal((await runDeviceAction('corrupt-db', fakeDevice([]).context)).ok, true);
    assert.equal((await runDeviceAction('copy-db', fakeDevice([['cp evia.db', out(1)]]).context)).ok, false);
  });

  it('EVM-093 AC3: kill -9 passes only when the process is gone afterwards', async () => {
    assert.equal((await runDeviceAction('kill-9', fakeDevice([['pidof', out(0, '')]]).context)).ok, true);
    assert.equal((await runDeviceAction('kill-9', fakeDevice([['pidof', out(0, '4242\n')]]).context)).ok, false);
    const failed = await runDeviceAction('kill-9', fakeDevice([['kill -9', out(1)]]).context);
    assert.deepEqual(failed, { action: 'kill-9', ok: false, detail: 'kill -9 through run-as failed' });
  });

  it('EVM-093 AC3: the restart waits for the boot flag, with a limit', async () => {
    let polls = 0;
    const booting = fakeDevice([['sys.boot_completed', () => out(0, (polls += 1) > 3 ? '1\n' : '')]]);
    assert.equal((await runDeviceAction('reboot', booting.context)).ok, true);
    assert.deepEqual(booting.calls.slice(0, 2), ['reboot', 'wait-for-device']);
    assert.match((await runDeviceAction('reboot', fakeDevice([['sys.boot_completed', out(0, '')]]).context)).detail, /not booted 180 s/);
    assert.equal((await runDeviceAction('reboot', fakeDevice([['reboot', out(1)]]).context)).ok, false);
  });

  it('EVM-093 AC1: check-encrypted combines header, app data, logcat and external storage; any failure fails the step', async () => {
    const clean = [
      ['od -A n', out(0, HEADER_HEX)],
      ['stat -c', out(0, '32768')],
      ['grep -r', out(1)],
      ['ls -d /sdcard', out(1)],
      ['logcat', out(0, 'I/app: ok\n')],
    ];
    const passed = await runDeviceAction('check-encrypted', fakeDevice(/** @type {never} */ (clean)).context);
    assert.equal(passed.ok, true, passed.detail);
    assert.match(passed.detail, /no external app storage/);
    const external = fakeDevice(/** @type {never} */ ([['ls -d /sdcard', out(0, '/sdcard/x')], ...clean]));
    assert.equal((await runDeviceAction('check-encrypted', external.context)).ok, true);
    assert.ok(external.calls.some((call) => call.startsWith('shell grep -r -l -a EVM093-SENTINEL /sdcard')));
    const leaked = fakeDevice(/** @type {never} */ ([['grep -r', out(0, 'f/SQLite/evia.db-wal\n')], ...clean]));
    assert.match((await runDeviceAction('check-encrypted', leaked.context)).detail, /sentinel is in 1 file/);
    const plain = fakeDevice(/** @type {never} */ ([['od -A n', out(0, PLAIN_HEX)], ...clean]));
    assert.equal((await runDeviceAction('check-encrypted', plain.context)).ok, false);
  });

  it('EVM-093 AC4: the backup transport check enables bmgr, selects the local transport and restores the previous one', async () => {
    const device = fakeDevice([
      ['bmgr enabled', out(0, 'Backup Manager currently disabled\n')],
      ['bmgr list transports', out(0, `    ${LOCAL_TRANSPORT}\n  * com.google.android.gms/.backup.BackupTransportService\n`)],
      [`backupnow ${BACKUP_CONTROL_PACKAGE}`, out(0, `Package ${BACKUP_CONTROL_PACKAGE} with result: Success\n`)],
      [`backupnow ${APP}`, out(0, `Package ${APP} with result: Backup is not allowed\n`)],
    ]);
    const result = await runDeviceAction('check-backup-transport', device.context);
    assert.equal(result.ok, true, result.detail);
    assert.ok(device.calls.includes('shell bmgr enable true'));
    assert.equal(device.calls.at(-1), 'shell bmgr transport com.google.android.gms/.backup.BackupTransportService');
    const noTransport = fakeDevice([['bmgr transport com.android.localtransport', out(1)]]);
    assert.match((await runDeviceAction('check-backup-transport', noTransport.context)).detail, /could not be selected/);
    const already = fakeDevice([
      ['bmgr enabled', out(0, 'Backup Manager currently enabled\n')],
      ['bmgr list transports', out(0, `  * ${LOCAL_TRANSPORT}\n`)],
    ]);
    assert.equal((await runDeviceAction('check-backup-transport', already.context)).ok, false);
    assert.ok(!already.calls.includes('shell bmgr enable true'));
    assert.equal(already.calls.filter((call) => call.startsWith('shell bmgr transport ')).length, 1);
  });

  it('EVM-093 AC4: adb backup is started detached for the confirmation flow; the archive is judged and removed', async () => {
    const start = fakeDevice([]);
    assert.equal((await runDeviceAction('adb-backup-start', start.context)).ok, true);
    assert.deepEqual(start.started, [`backup -f /r/.scratch/mobile-e2e/evm093-backup.ab -noapk ${APP}`]);
    assert.deepEqual(start.removed, ['/r/.scratch/mobile-e2e/evm093-backup.ab']);
    const check = fakeDevice([], { archive: archive([]) });
    assert.equal((await runDeviceAction('adb-backup-check', check.context)).ok, true);
    assert.deepEqual(check.removed, ['/r/.scratch/mobile-e2e/evm093-backup.ab']);
    const missing = await runDeviceAction('adb-backup-check', fakeDevice([], { archive: null }).context);
    assert.match(missing.detail, /no archive/);
  });
});
