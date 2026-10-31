// @ts-check
/**
 * Device steps of the local-store scenarios (EVM-093 AC1, AC3–AC7; ADR-0015): what adb does to the e2e app between and after the
 * Maestro flows, and how its answers are judged. The e2e variant is debuggable, so `run-as` reads the app directory without root (the
 * AVD is a Google Play image, `adb root` does not work there). Builders return arguments for adb; strings for `adb shell` are fixed
 * text without input from outside. Every judgement reports counts and codes — never a path inside the app, a file content or a key.
 *
 * AC4 (decision of Konrad, option a): `adb backup` is judged on a NOT debuggable release package of the same run (signed locally with
 * the debug key of the template so that `install -r` keeps the data of the e2e variant), installed over the e2e app and replaced by
 * the e2e package again right after (`install-release-debugkey`, `adb-backup-check`, `reinstall-e2e`).
 *
 * @typedef {'force-stop' | 'kill-9' | 'reboot' | 'copy-db' | 'corrupt-db' | 'check-encrypted' | 'check-backup-transport'
 *   | 'adb-backup-start' | 'adb-backup-check' | 'adb-backup-control-check' | 'install-release-debugkey' | 'reinstall-e2e'} DeviceAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ action: DeviceAction, ok: boolean, detail: string }} Check
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { APPLICATION_ID } from './commands.mjs';

/** The marker that the hooks write into the queue (composed at run time in the app); it must not appear in any file or log. */
export const SENTINEL = ['EVM093', 'SENTINEL'].join('-');
/** Where expo-sqlite keeps the database (default directory, `files/SQLite`). */
export const DATABASE = 'files/SQLite/evia.db';
const NEWLINE = /\r?\n/;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
export const LOCAL_TRANSPORT = 'com.android.localtransport/.LocalTransport';
/** A system package that allows backup: the positive control that the transport really works. */
export const BACKUP_CONTROL_PACKAGE = 'com.android.providers.settings';
export const BOOT_ATTEMPTS = 90;

/** Commands of the device steps (arguments of adb after `-s <serial>`). */
export const deviceCommands = {
  forceStop: () => ['shell', 'am', 'force-stop', APPLICATION_ID],
  /** `kill` of another uid fails without root: run-as gives the uid of the app; pidof runs in the device shell first. */
  kill9: () => ['shell', `run-as ${APPLICATION_ID} kill -9 $(pidof ${APPLICATION_ID})`],
  pidof: () => ['shell', 'pidof', APPLICATION_ID],
  reboot: () => ['reboot'],
  waitForDevice: () => ['wait-for-device'],
  bootCompleted: () => ['shell', 'getprop', 'sys.boot_completed'],
  /** First 16 bytes of the database file as hex (toybox od): binary output never passes through a text decoder. */
  header: () => ['shell', `run-as ${APPLICATION_ID} od -A n -t x1 -N 16 ${DATABASE}`],
  /** Size of the database file and its sidecars in bytes (a missing file is not "encrypted"). */
  size: () => ['shell', `run-as ${APPLICATION_ID} stat -c %s ${DATABASE}`],
  /** Every file of the app data directory (files/ with SQLite and its -wal/-shm, databases/, shared_prefs/, cache/, no_backup/ …). */
  grepAppData: () => ['shell', `run-as ${APPLICATION_ID} grep -r -l -a ${SENTINEL} /data/data/${APPLICATION_ID}`],
  externalExists: () => ['shell', `ls -d /sdcard/Android/data/${APPLICATION_ID}`],
  grepExternal: () => ['shell', `grep -r -l -a ${SENTINEL} /sdcard/Android/data/${APPLICATION_ID}`],
  logcat: () => ['logcat', '-d'],
  /** The copy of scenario 13 (main file and the write-ahead log, which may hold the newest pages). */
  copyDatabase: () => [
    'shell',
    `run-as ${APPLICATION_ID} sh -c 'cd files/SQLite && cp evia.db evia-copy.db && rm -f evia-copy.db-wal evia-copy.db-shm && if [ -f evia.db-wal ]; then cp evia.db-wal evia-copy.db-wal; fi'`,
  ],
  /** Scenario 12: the first page is zeroed and the log removed, so no newer copy of page 1 survives (the key check value stays). */
  corruptDatabase: () => [
    'shell',
    `run-as ${APPLICATION_ID} sh -c 'cd files/SQLite && dd if=/dev/zero of=evia.db bs=4096 count=1 conv=notrunc && rm -f evia.db-wal evia.db-shm'`,
  ],
  bmgrEnabled: () => ['shell', 'bmgr', 'enabled'],
  bmgrEnable: () => ['shell', 'bmgr', 'enable', 'true'],
  bmgrTransports: () => ['shell', 'bmgr', 'list', 'transports'],
  /** @param {string} transport */
  bmgrTransport: (transport) => ['shell', 'bmgr', 'transport', transport],
  /** @param {string} packageName */
  bmgrBackupNow: (packageName) => ['shell', 'bmgr', 'backupnow', packageName],
  /** @param {string} file local path of the archive (.scratch) */
  adbBackup: (file) => ['backup', '-f', file, '-noapk', APPLICATION_ID],
  /** @param {string} apk local path of the package; `-r` keeps the data of the app */
  install: (apk) => ['install', '-r', apk],
  dumpsysPackage: () => ['shell', 'dumpsys', 'package', APPLICATION_ID],
  /** run-as of a package that is not debuggable is refused by the system ("package not debuggable") */
  runAsProbe: () => ['shell', 'run-as', APPLICATION_ID, 'id'],
  packagePath: () => ['shell', 'pm', 'path', APPLICATION_ID],
  /** @param {string} path checked by `installedApkPath` (a plain /data/app path, no shell characters) */
  sha256sum: (path) => ['shell', 'sha256sum', path],
};

/**
 * AC1: the file exists, has at least a header, and the header is not the plain SQLite one.
 * @param {Outcome} header answer of `deviceCommands.header`
 * @param {Outcome} size answer of `deviceCommands.size`
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeHeader(header, size) {
  const bytes = Number.parseInt(size.stdout.trim(), 10);
  if (size.status !== 0 || !Number.isFinite(bytes)) return { ok: false, detail: 'database file not readable through run-as' };
  if (bytes < 4096) return { ok: false, detail: `database file has ${String(bytes)} bytes (no page written: the check would be empty)` };
  const hex = header.stdout.replace(/[^0-9a-f]/gi, '');
  if (header.status !== 0 || hex.length !== 32) return { ok: false, detail: 'header of the database file not readable' };
  return Buffer.from(hex, 'hex').equals(SQLITE_HEADER)
    ? { ok: false, detail: 'the database file starts with the plain SQLite header' }
    : { ok: true, detail: `header is not "SQLite format 3" (${String(bytes)} bytes)` };
}

/**
 * AC1: `grep -r -l` exits 1 when nothing matched; 0 = found (the count of files only); anything else = the tool failed (not a pass).
 * @param {Outcome} outcome
 * @param {string} where
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeGrep(outcome, where) {
  if (outcome.status === 1 && outcome.stdout.trim() === '') return { ok: true, detail: `no file in ${where} carries the sentinel` };
  if (outcome.status === 0) {
    const files = outcome.stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length;
    return { ok: false, detail: `the sentinel is in ${String(files)} file(s) of ${where}` };
  }
  return { ok: false, detail: `grep over ${where} failed (exit ${String(outcome.status)})` };
}

/**
 * @param {Outcome} logcat
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeLogcat(logcat) {
  if (logcat.status !== 0) return { ok: false, detail: 'logcat could not be read' };
  const lines = logcat.stdout.split(/\r?\n/).filter((line) => line.includes(SENTINEL)).length;
  return lines === 0
    ? { ok: true, detail: 'no logcat line carries the sentinel' }
    : { ok: false, detail: `${String(lines)} logcat line(s) carry the sentinel` };
}

/**
 * AC4 (security K7): the local transport works (the control package is backed up) and the app is refused. An unexpected answer or a
 * failed command is a failure, never a skip.
 * @param {Outcome} app `bmgr backupnow` of the app
 * @param {Outcome} control `bmgr backupnow` of the control package
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeBackupTransport(app, control) {
  const controlLine = control.stdout.split(NEWLINE).find((text) => text.includes(BACKUP_CONTROL_PACKAGE)) ?? '';
  if (control.status !== 0 || !/success/i.test(controlLine))
    return { ok: false, detail: 'the local transport did not back up the control package' };
  if (app.status !== 0) return { ok: false, detail: `bmgr backupnow of the app failed (exit ${String(app.status)})` };
  const line = app.stdout.split(/\r?\n/).find((text) => text.includes(APPLICATION_ID)) ?? '';
  if (/success/i.test(line)) return { ok: false, detail: 'the app WAS backed up by the local transport' };
  return /not allowed|not eligible|disabled/i.test(line)
    ? { ok: true, detail: 'backup of the app refused by the system, control package backed up' }
    : { ok: false, detail: 'unexpected answer of bmgr for the app' };
}

/**
 * The transport currently selected (`*` in `bmgr list transports`).
 * @param {string} listing
 */
export function currentTransport(listing) {
  return listing
    .split(/\r?\n/)
    .map((line) => /^\s*\*\s*(\S+)/.exec(line)?.[1])
    .find((name) => name !== undefined);
}

/**
 * Names of the entries of an `adb backup` archive ("ANDROID BACKUP" header, then a tar stream, deflated when the flag is 1).
 * @param {Buffer} archive
 * @returns {string[] | null} null = not a backup archive (or encrypted)
 */
export function backupEntries(archive) {
  const headerEnd = nthNewline(archive, 4);
  if (headerEnd < 0) return null;
  const [magic, , compressed, encryption] = archive.subarray(0, headerEnd).toString('latin1').split('\n');
  if (magic !== 'ANDROID BACKUP' || encryption !== 'none') return null;
  let tar = archive.subarray(headerEnd + 1);
  if (compressed === '1') {
    try {
      tar = tar.length === 0 ? tar : inflateSync(tar, { finishFlush: 2 });
    } catch {
      return null;
    }
  }
  /** @type {string[]} */
  const names = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    const name = block.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
    const prefix = block.subarray(345, 500).toString('latin1').replace(/\0.*$/s, '');
    const size = Number.parseInt(block.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    names.push(prefix === '' ? name : `${prefix}/${name}`);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

/** @param {Buffer} buffer @param {number} n */
function nthNewline(buffer, n) {
  let at = -1;
  for (let i = 0; i < n; i += 1) {
    at = buffer.indexOf(0x0a, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/**
 * AC4 (security K7): the archive exists and is a backup archive, and no entry of the app's data domains is in it — database
 * (`f/SQLite/evia.db*`, `db/`), the key check value and the wipe marker (`f/`), the secure store (`sp/`), `nb/`, `c/`, `r/`, `ef/`.
 * @param {Buffer | null} archive
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeAdbBackup(archive) {
  if (archive === null || archive.length === 0)
    return { ok: false, detail: 'adb backup produced no archive (not confirmed on the device?)' };
  const names = backupEntries(archive);
  if (names === null) return { ok: false, detail: 'the archive is not a readable adb backup' };
  const ofApp = names.filter((name) => name.startsWith(`apps/${APPLICATION_ID}/`) && !name.endsWith('/_manifest'));
  const domains = [...new Set(ofApp.map((name) => name.split('/')[2] ?? '?'))].sort();
  return ofApp.length === 0
    ? { ok: true, detail: `archive of ${String(archive.length)} bytes, ${String(names.length)} entries, none from the app data` }
    : { ok: false, detail: `${String(ofApp.length)} entries of the app data in the archive (domains: ${domains.join(', ')})` };
}

/**
 * AC4 positive control on the debuggable e2e build: Android 12+ backs up a debuggable app whatever allowBackup says, so the archive
 * MUST hold app data. It is NOT the proof of AC4; it shows that the transport and the parser work, so that "0 entries" of the release
 * package is the policy of the system and not a broken transport that wrote only a header.
 * @param {Buffer | null} archive
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeAdbBackupControl(archive) {
  if (archive === null || archive.length === 0)
    return { ok: false, detail: 'adb backup produced no archive (not confirmed on the device?)' };
  const names = backupEntries(archive);
  if (names === null) return { ok: false, detail: 'the archive is not a readable adb backup' };
  const ofApp = names.filter((name) => name.startsWith(`apps/${APPLICATION_ID}/`) && !name.endsWith('/_manifest'));
  const domains = [...new Set(ofApp.map((name) => name.split('/')[2] ?? '?'))].sort();
  return ofApp.length > 0
    ? {
        ok: true,
        detail: `positive control (debuggable e2e build): ${String(ofApp.length)} entries of the app data (domains: ${domains.join(', ')}), the transport works`,
      }
    : {
        ok: false,
        detail: 'positive control failed: no entry of the app data in the archive of the debuggable build (the transport proves nothing)',
      };
}

/** @param {Outcome} outcome */
export function judgeInstall(outcome) {
  return outcome.status === 0 && /^Success\s*$/m.test(outcome.stdout)
    ? { ok: true, detail: 'installed with -r (data kept)' }
    : { ok: false, detail: `adb install -r failed (exit ${String(outcome.status)})` };
}

/**
 * The flags of the package section of `dumpsys package` (`flags=[ … ]`, `pkgFlags=[ … ]` on older releases; never privateFlags).
 * Deny by default: no package section or no flags line is a failure, not a pass.
 * @param {Outcome} outcome
 * @param {boolean} debuggable what the package must be
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeDebuggable(outcome, debuggable) {
  if (outcome.status !== 0) return { ok: false, detail: `dumpsys package failed (exit ${String(outcome.status)})` };
  if (!outcome.stdout.includes(`Package [${APPLICATION_ID}]`)) return { ok: false, detail: 'dumpsys: the package is not installed' };
  const lines = outcome.stdout
    .split(NEWLINE)
    .map((line) => /^\s*(?:pkgFlags|flags)=\[(.*)\]\s*$/.exec(line)?.[1])
    .filter((flags) => flags !== undefined);
  if (lines.length === 0) return { ok: false, detail: 'dumpsys: no flags line of the package (cannot tell whether it is debuggable)' };
  const flags = new Set(lines.flatMap((line) => line.trim().split(/\s+/)));
  if (debuggable) {
    return flags.has('DEBUGGABLE')
      ? { ok: true, detail: 'the e2e package is installed again (DEBUGGABLE)' }
      : { ok: false, detail: 'the package on the device is not the debuggable e2e build' };
  }
  if (flags.has('DEBUGGABLE')) return { ok: false, detail: 'the installed package is DEBUGGABLE: it is not the release build' };
  if (flags.has('ALLOW_BACKUP')) return { ok: false, detail: 'the installed package has ALLOW_BACKUP' };
  return { ok: true, detail: 'dumpsys: flags without DEBUGGABLE and ALLOW_BACKUP' };
}

/** @param {Outcome} outcome */
export function judgeRunAsRefused(outcome) {
  if (outcome.status === 0) return { ok: false, detail: 'run-as works: the installed package is debuggable' };
  return /not debuggable/i.test(`${outcome.stdout}\n${outcome.stderr}`)
    ? { ok: true, detail: 'run-as refused (package not debuggable)' }
    : { ok: false, detail: `run-as failed for another reason (exit ${String(outcome.status)})` };
}

/**
 * @param {Outcome} outcome answer of `pm path`
 * @returns {string | null} the base.apk path, only a plain /data/app path (it goes into an adb shell command)
 */
export function installedApkPath(outcome) {
  if (outcome.status !== 0) return null;
  for (const line of outcome.stdout.split(NEWLINE)) {
    const path = /^package:(\/data\/app\/[\w.~=+-]+(?:\/[\w.~=+-]+)*\/base\.apk)$/.exec(line.trim())?.[1];
    if (path !== undefined) return path;
  }
  return null;
}

/**
 * The last logcat line about the backup eligibility of the app, as "tag: message" (no other line, no time or pids — security K7).
 * @param {Outcome} outcome
 * @returns {string | null}
 */
export function backupLogLine(outcome) {
  if (outcome.status !== 0) return null;
  const line = outcome.stdout
    .split(NEWLINE)
    .filter((text) => text.includes(APPLICATION_ID) && /eligible/i.test(text))
    .at(-1);
  if (line === undefined) return null;
  const parsed = /\s[VDIWEF]\s+([^:]+):\s(.*)$/.exec(line);
  return (parsed === null ? line.trim() : `${(parsed[1] ?? '').trim()}: ${(parsed[2] ?? '').trim()}`).slice(0, 200);
}

/**
 * @typedef {{
 *   adb: (...args: string[]) => Outcome,
 *   startAdb: (...args: string[]) => void,
 *   sleep: (ms: number) => Promise<void>,
 *   readBytes: (path: string) => Buffer | null,
 *   removeFile: (path: string) => void,
 *   backupFile: string,
 *   releaseApk: string,
 *   e2eApk: string,
 * }} DeviceContext adb with the serial already applied; the archive lives in .scratch and is removed after the check;
 * `releaseApk` is the not debuggable release package signed with the debug key (.scratch/mobile-e2e/*-debugkey.apk), `e2eApk` the e2e one
 */

/** @param {Outcome} outcome */
const succeeded = (outcome) => outcome.status === 0;

/**
 * Runs one device step and judges it.
 * @param {DeviceAction} action
 * @param {DeviceContext} context
 * @returns {Promise<Check>}
 */
export async function runDeviceAction(action, context) {
  const { adb } = context;
  /** @param {boolean} ok @param {string} detail @returns {Check} */
  const check = (ok, detail) => ({ action, ok, detail });
  switch (action) {
    case 'force-stop':
      return check(succeeded(adb(...deviceCommands.forceStop())), 'am force-stop');
    case 'kill-9': {
      // without a running app pidof prints nothing and `kill -9` without a pid exits non-zero: a failure, never a pass
      const killed = succeeded(adb(...deviceCommands.kill9()));
      await context.sleep(1000);
      const after = adb(...deviceCommands.pidof()).stdout.trim();
      return check(killed && after === '', killed ? 'process killed with SIGKILL' : 'kill -9 through run-as failed');
    }
    case 'reboot': {
      if (!succeeded(adb(...deviceCommands.reboot()))) return check(false, 'adb reboot failed');
      await context.sleep(5000);
      adb(...deviceCommands.waitForDevice());
      for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt += 1) {
        if (adb(...deviceCommands.bootCompleted()).stdout.trim() === '1') return check(true, 'emulator restarted and booted');
        await context.sleep(2000);
      }
      return check(false, `emulator not booted ${String(BOOT_ATTEMPTS * 2)} s after the restart`);
    }
    case 'copy-db':
      return check(succeeded(adb(...deviceCommands.copyDatabase())), 'database file and log copied inside the app directory');
    case 'corrupt-db':
      return check(succeeded(adb(...deviceCommands.corruptDatabase())), 'first page of the database zeroed, log removed');
    case 'check-encrypted': {
      const results = [
        judgeHeader(adb(...deviceCommands.header()), adb(...deviceCommands.size())),
        judgeGrep(adb(...deviceCommands.grepAppData()), 'the app data directory'),
        judgeLogcat(adb(...deviceCommands.logcat())),
      ];
      if (succeeded(adb(...deviceCommands.externalExists())))
        results.push(judgeGrep(adb(...deviceCommands.grepExternal()), 'external app storage'));
      else results.push({ ok: true, detail: 'no external app storage' });
      return check(
        results.every((result) => result.ok),
        results.map((result) => result.detail).join('; '),
      );
    }
    case 'check-backup-transport': {
      if (!/currently enabled/i.test(adb(...deviceCommands.bmgrEnabled()).stdout)) adb(...deviceCommands.bmgrEnable());
      const previous = currentTransport(adb(...deviceCommands.bmgrTransports()).stdout);
      if (!succeeded(adb(...deviceCommands.bmgrTransport(LOCAL_TRANSPORT))))
        return check(false, 'the local transport could not be selected');
      try {
        const control = adb(...deviceCommands.bmgrBackupNow(BACKUP_CONTROL_PACKAGE));
        const app = adb(...deviceCommands.bmgrBackupNow(APPLICATION_ID));
        const judged = judgeBackupTransport(app, control);
        return check(judged.ok, judged.detail);
      } finally {
        if (previous !== undefined && previous !== LOCAL_TRANSPORT) adb(...deviceCommands.bmgrTransport(previous));
      }
    }
    case 'adb-backup-start':
      context.removeFile(context.backupFile);
      context.startAdb(...deviceCommands.adbBackup(context.backupFile));
      await context.sleep(3000);
      return check(true, 'adb backup started (the flow confirms it on the device)');
    case 'adb-backup-check': {
      const judged = judgeAdbBackup(await settledArchive(context));
      const line = backupLogLine(adb(...deviceCommands.logcat()));
      return check(judged.ok, `${judged.detail}; logcat: ${line === null ? 'no line about the backup of the app' : `"${line}"`}`);
    }
    case 'adb-backup-control-check': {
      const judged = judgeAdbBackupControl(await settledArchive(context));
      return check(judged.ok, judged.detail);
    }
    case 'install-release-debugkey': {
      const installed = judgeInstall(adb(...deviceCommands.install(context.releaseApk)));
      if (!installed.ok) return check(false, `release package: ${installed.detail}`);
      const results = [
        judgeDebuggable(adb(...deviceCommands.dumpsysPackage()), false),
        judgeRunAsRefused(adb(...deviceCommands.runAsProbe())),
        judgeInstalledDigest(context),
      ];
      return check(
        results.every((result) => result.ok),
        `release package installed over the e2e data; ${results.map((result) => result.detail).join('; ')}`,
      );
    }
    case 'reinstall-e2e': {
      const installed = judgeInstall(adb(...deviceCommands.install(context.e2eApk)));
      if (!installed.ok) return check(false, `e2e package: ${installed.detail}`);
      const judged = judgeDebuggable(adb(...deviceCommands.dumpsysPackage()), true);
      return check(judged.ok, judged.detail);
    }
  }
}

/**
 * Waits until the archive stops growing (adb writes it while the device streams), reads it and removes it (security K7).
 * @param {DeviceContext} context
 * @returns {Promise<Buffer | null>}
 */
async function settledArchive(context) {
  /** @type {Buffer | null} */
  let archive = null;
  let previousLength = -1;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    archive = context.readBytes(context.backupFile);
    if (archive !== null && archive.length > 0 && archive.length === previousLength) break;
    previousLength = archive?.length ?? -1;
    await context.sleep(1000);
  }
  context.removeFile(context.backupFile);
  return archive;
}

/**
 * The base.apk on the device is exactly the local release file (SHA-256 of both).
 * @param {DeviceContext} context
 * @returns {{ ok: boolean, detail: string }}
 */
function judgeInstalledDigest(context) {
  const local = context.readBytes(context.releaseApk);
  if (local === null) return { ok: false, detail: 'the local release package is missing' };
  const expected = createHash('sha256').update(local).digest('hex');
  const path = installedApkPath(context.adb(...deviceCommands.packagePath()));
  if (path === null) return { ok: false, detail: 'pm path gave no base.apk of the app' };
  const answer = context.adb(...deviceCommands.sha256sum(path));
  const actual = /^([0-9a-f]{64})\b/i.exec(answer.stdout.trim())?.[1]?.toLowerCase();
  if (answer.status !== 0 || actual === undefined) return { ok: false, detail: 'sha256sum of the installed base.apk failed' };
  return actual === expected
    ? { ok: true, detail: `installed base.apk = built file, SHA-256 ${expected}` }
    : { ok: false, detail: 'the installed base.apk is not the built release file' };
}
