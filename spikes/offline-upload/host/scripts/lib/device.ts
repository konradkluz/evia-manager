// adb / emulator helpers for the EVM-011 scenarios (Android emulator only). Every process gets an argument array, never a shell.
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const ANDROID_HOME = process.env.ANDROID_HOME ?? 'C:\\Users\\Konrad\\AppData\\Local\\Android\\Sdk';
export const ADB = join(ANDROID_HOME, 'platform-tools', 'adb.exe');
export const EMULATOR = join(ANDROID_HOME, 'emulator', 'emulator.exe');
export const AVD = 'Medium_Phone_API_35';
export const PKG = 'pl.eviacharge.spike.offlineupload';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function adb(...args: string[]): Promise<string> {
  const { stdout } = await run(ADB, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/** `adb shell <one string>`: the string is interpreted by the DEVICE shell. */
export const sh = (cmd: string) => adb('shell', cmd);
export const runAs = (cmd: string) => adb('shell', `run-as ${PKG} sh -c '${cmd}'`);

export async function bootCompleted(): Promise<boolean> {
  try {
    return (await sh('getprop sys.boot_completed')).trim() === '1';
  } catch {
    return false;
  }
}

export async function waitForBoot(timeoutMs = 240_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await bootCompleted()) return;
    await sleep(2000);
  }
  throw new Error('emulator did not boot in time');
}

export async function emulatorRunning(): Promise<boolean> {
  try {
    return (await adb('devices')).includes('emulator-5554');
  } catch {
    return false;
  }
}

/** Starts the single AVD (ADR-0015: one emulator at a time). No audio: the emulator microphone is the host microphone. */
export async function startEmulator(extra: string[] = []): Promise<void> {
  if (await emulatorRunning()) return;
  const child = spawn(EMULATOR, ['-avd', AVD, '-no-snapshot-save', '-no-boot-anim', '-no-audio', '-no-window', ...extra], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME },
  });
  child.unref();
  await sleep(5000);
  await waitForBoot();
}

/** Emulator console (telnet-like, authenticated with the per-user token). Used for `network speed` throttling. */
export function consoleCommand(cmd: string): Promise<string> {
  const token = readFileSync(join(homedir(), '.emulator_console_auth_token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const s = connect(5554, '127.0.0.1');
    let out = '';
    s.on('data', (d) => (out += d.toString()));
    s.on('error', reject);
    s.on('connect', () => {
      s.write(`auth ${token}\r\n${cmd}\r\nquit\r\n`);
    });
    s.on('close', () => resolve(out.replace(token, '<token>')));
    setTimeout(() => s.destroy(), 8000);
  });
}

export async function killEmulator(): Promise<void> {
  try {
    await adb('emu', 'kill');
  } catch {
    // not running
  }
}

/** The same hash the Kotlin side uses for the JobScheduler id (String.hashCode & 0x7fffffff) % 900000 + 1000. */
export function jobIdFor(assetId: string): number {
  let h = 0;
  for (const ch of assetId) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return ((h & 0x7fffffff) % 900_000) + 1000;
}

export interface DeviceJob {
  assetId: string;
  filePath: string;
  size: number;
  sha256: string;
  state: string;
  partSize?: number;
  partCount?: number;
  etags?: Record<string, string>;
  retries?: number;
  renewals?: number;
  partPuts?: number;
  skippedParts?: number;
  retransmittedBytes?: number;
  stops?: number;
  runs?: number;
  lastStopReason?: number;
  startedAt?: number;
  finishedAt?: number;
  createdAt?: number;
  lastError?: string;
  localDeleted?: boolean;
}

export async function readJobs(): Promise<DeviceJob[]> {
  let out = '';
  try {
    out = await adb('exec-out', `run-as ${PKG} sh -c 'for f in no_backup/evm011/jobs/*.json; do cat "$f"; echo; done'`);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as DeviceJob);
}

export async function startApp(extras: Record<string, string> = {}): Promise<void> {
  const args = ['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`];
  for (const [k, v] of Object.entries(extras)) args.push('-e', `evm011_${k}`, v);
  await adb(...args);
}

/** Puts a host file into the app sandbox without MediaStore: push to /data/local/tmp, run-as cp, remove the temp copy. */
export async function pushIntoSandbox(hostFile: string, name: string): Promise<string> {
  const tmp = `/data/local/tmp/${name}`;
  await adb('push', hostFile, tmp);
  await runAs(`mkdir -p files/media && cp ${tmp} files/media/${name} && sync`);
  await sh(`rm -f ${tmp}`);
  return `/data/user/0/${PKG}/files/media/${name}`;
}

export async function freeKb(path = '/data'): Promise<number> {
  const out = await sh(`df -k ${path}`);
  const line = out.trim().split('\n').at(-1)!.split(/\s+/);
  return Number(line[3]);
}

export async function logcatEvm(): Promise<string[]> {
  const out = await adb('logcat', '-d', '-v', 'epoch', '-s', 'EVM011:I');
  return out.split('\n').filter((l) => l.includes('EVM011'));
}

export async function pidOfApp(): Promise<string> {
  return (await sh(`pidof ${PKG}`)).trim();
}

export async function jobState(assetId: string): Promise<string> {
  try {
    return (await sh(`cmd jobscheduler get-job-state -u 0 ${PKG} ${jobIdFor(assetId)}`)).trim();
  } catch (e) {
    return `error:${(e as Error).message.slice(0, 40)}`;
  }
}
