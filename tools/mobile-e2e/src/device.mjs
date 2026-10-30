// @ts-check
/**
 * Device steps of the local-store scenarios (EVM-093 AC1, AC3–AC7; ADR-0015): what adb does to the e2e app between and after the
 * Maestro flows, and how its answers are judged. The e2e variant is debuggable, so `run-as` reads the app directory without root (the
 * AVD is a Google Play image, `adb root` does not work there). Builders return arguments for adb; strings for `adb shell` are fixed
 * text without input from outside. Every judgement reports counts and codes — never a path inside the app, a file content or a key.
 *
 * @typedef {'force-stop' | 'kill-9' | 'reboot' | 'copy-db' | 'corrupt-db' | 'check-encrypted' | 'check-backup-transport'
 *   | 'adb-backup-start' | 'adb-backup-check'} DeviceAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ action: DeviceAction, ok: boolean, detail: string }} Check
 */
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
 * @typedef {{
 *   adb: (...args: string[]) => Outcome,
 *   startAdb: (...args: string[]) => void,
 *   sleep: (ms: number) => Promise<void>,
 *   readBytes: (path: string) => Buffer | null,
 *   removeFile: (path: string) => void,
 *   backupFile: string,
 * }} DeviceContext adb with the serial already applied; the archive lives in .scratch and is removed after the check
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
      /** @type {Buffer | null} */
      let archive = null;
      let previousLength = -1;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        archive = context.readBytes(context.backupFile);
        if (archive !== null && archive.length > 0 && archive.length === previousLength) break;
        previousLength = archive?.length ?? -1;
        await context.sleep(1000);
      }
      const judged = judgeAdbBackup(archive);
      context.removeFile(context.backupFile);
      return check(judged.ok, judged.detail);
    }
  }
}
