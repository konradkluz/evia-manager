// EVM-011 AC2/AC3 scenarios on the Android EMULATOR (never claims phone results). Usage:
//   node scripts/scenarios.ts <scenario> [--runs N] [--mib N]
// Scenarios: airplane | forcestop | kill9 | killcomplete | reboot | reboot-pin | background | big | wifi-lte | checks
// Results (JSON, no tokens or signed URLs) go to .scratch/EVM-011/results/. Synthetic pseudo-random files only; NOT camera footage.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createIssuer, type Issuer } from '../src/issuer.ts';
import { RESULTS_DIR, S3_ENDPOINT, countDuplicates, ensureBucket, loadLocal, s3Client } from '../src/local.ts';
import { makeSyntheticFile } from '../src/synthetic.ts';
import { createThrottleProxy, type ThrottleProxy } from '../src/throttle-proxy.ts';
import { objectSha256 } from '../src/verify.ts';
import * as dev from './lib/device.ts';

const MiB = 1024 * 1024;
const args = process.argv.slice(2);
const scenario = args[0] ?? '';
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? Number(args[i + 1]) : fallback;
};

const local = loadLocal();
const s3 = s3Client(local);
const work = join(tmpdir(), 'evm011-scenarios');
mkdirSync(work, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

let issuer!: Issuer;
const issuerLog: string[] = [];
const t0 = Date.now();
const nonce = Date.now().toString(36);
const steps: { tMs: number; step: string; data?: unknown }[] = [];
const note = (step: string, data?: unknown) => {
  steps.push({ tMs: Date.now() - t0, step, data });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`);
};

async function startIssuer(ttl = 3600, signPort = 8333) {
  await ensureBucket(s3, local.bucket);
  issuer = createIssuer({
    s3Endpoint: S3_ENDPOINT,
    signEndpoint: `http://10.0.2.2:${signPort}`,
    bucket: local.bucket,
    accessKey: local.accessKey,
    secretKey: local.secretKey,
    token: local.token,
    ttlSeconds: ttl,
    defaultPartSize: 16 * MiB,
    statePath: resolve(RESULTS_DIR, '../issuer-state.json'),
    port: 8787,
    log: (l) => issuerLog.push(`${Date.now()} ${l}`),
  });
  await issuer.listen();
}

/** Clean slate: app data (jobs, DB, token), S3 objects, open multiparts, issuer mapping. Each scenario then measures on its own. */
async function resetAll() {
  // undo anything an earlier (possibly interrupted) run may have left behind
  for (const c of ['svc wifi enable', 'dumpsys deviceidle unforce', 'dumpsys battery reset', 'cmd connectivity airplane-mode disable']) {
    await dev.sh(c).catch(() => undefined);
  }
  await dev.sh(`am set-standby-bucket ${dev.PKG} active`).catch(() => undefined);
  await dev.consoleCommand('network speed full').catch(() => undefined);
  await dev.sh(`pm clear ${dev.PKG}`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.CAMERA`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.POST_NOTIFICATIONS`);
  const { DeleteObjectCommand, ListObjectsV2Command, ListMultipartUploadsCommand, AbortMultipartUploadCommand } =
    await import('@aws-sdk/client-s3');
  for (const o of (await s3.send(new ListObjectsV2Command({ Bucket: local.bucket }))).Contents ?? [])
    await s3.send(new DeleteObjectCommand({ Bucket: local.bucket, Key: o.Key! }));
  for (const u of (await s3.send(new ListMultipartUploadsCommand({ Bucket: local.bucket }))).Uploads ?? [])
    await s3.send(new AbortMultipartUploadCommand({ Bucket: local.bucket, Key: u.Key!, UploadId: u.UploadId! }));
  rmSync(resolve(RESULTS_DIR, '../issuer-state.json'), { force: true });
}

async function configureApp() {
  await dev.startApp({ cmd: 'configure', token: local.token, base: 'http://10.0.2.2:8787', device: 'emulator-device-1' });
  await dev.sleep(4000);
}

const pingHost = async () => {
  try {
    await dev.sh('ping -c 1 -W 2 10.0.2.2');
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (pred: () => Promise<boolean>, timeoutMs: number, pollMs = 1000): Promise<boolean> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await pred()) return true;
    await dev.sleep(pollMs);
  }
  return false;
};

interface Planted {
  sha: string;
  size: number;
  name: string;
}

/** Creates a synthetic file on the host, puts it into the sandbox and enqueues it through the app. */
async function plant(bytes: number, seed: string, type: 'video/mp4' | 'image/jpeg', killFlag = false): Promise<Planted> {
  const name = `${seed}.${type === 'video/mp4' ? 'mp4' : 'jpg'}`;
  const host = join(work, name);
  const sha = await makeSyntheticFile(host, bytes, seed);
  const path = await dev.pushIntoSandbox(host, name);
  rmSync(host, { force: true });
  const extras: Record<string, string> = { cmd: 'enqueue', path, type };
  if (killFlag) extras.flag = 'kill_after_complete';
  await dev.startApp(extras);
  return { sha, size: bytes, name };
}

async function jobsBySha(planted: Planted[]) {
  const jobs = await dev.readJobs();
  return planted.map((p) => jobs.find((j) => j.sha256 === p.sha));
}

const allUploaded = async (planted: Planted[]) => (await jobsBySha(planted)).every((j) => j?.state === 'uploaded');
const partsDone = (j?: dev.DeviceJob) => Object.keys(j?.etags ?? {}).length;

/** Integrity: SHA-256 recorded on the device (native, streaming) vs. SHA-256 of the stored object (host, streaming from S3). */
async function verifyAll(planted: Planted[]) {
  const out = [];
  for (const [i, j] of (await jobsBySha(planted)).entries()) {
    const p = planted[i]!;
    const rec = j ? issuer.sessions().find((s) => s.assetId === j.assetId) : undefined;
    if (!j || !rec) {
      out.push({ file: p.name, ok: false, reason: 'no job or session' });
      continue;
    }
    const stored = await objectSha256(s3, local.bucket, rec.key);
    out.push({
      assetId: j.assetId,
      ok: stored.sha256 === p.sha && stored.size === p.size && j.sha256 === p.sha,
      deviceShaMatchesHost: j.sha256 === p.sha,
      objectShaMatches: stored.sha256 === p.sha,
      size: stored.size,
      uploadMs: j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : undefined,
      retries: j.retries ?? 0,
      renewals: j.renewals ?? 0,
      partPuts: j.partPuts ?? 0,
      skippedParts: j.skippedParts ?? 0,
      retransmittedBytes: j.retransmittedBytes ?? 0,
      stops: j.stops ?? 0,
      runs: j.runs ?? 0,
    });
  }
  return out;
}

async function finish(name: string, extra: Record<string, unknown> = {}) {
  const dup = await countDuplicates(s3, local.bucket);
  const info = (await dev.sh('getprop ro.build.version.sdk')).trim();
  const result = {
    scenario: name,
    emulator: { avd: dev.AVD, apiLevel: info, release: (await dev.sh('getprop ro.build.version.release')).trim() },
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - t0,
    duplicates: dup,
    issuerRequests: issuerLog.length,
    createSessionCalls: issuerLog.filter((l) => l.includes('POST /v1/uploads 200')).length,
    ...extra,
    steps,
    logcat: (await dev.logcatEvm()).slice(-400),
  };
  const file = join(RESULTS_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`result written: ${file}`);
  console.log(JSON.stringify({ duplicates: dup, ...extra }, null, 1).slice(0, 3000));
}

/** NOTE: measured to have NO effect on the transfer speed of the emulator (uploads ran at the natural ~4 MiB/s with the setting at 24000/3000 kbit/s); kept only as a record of what was tried. The background scenarios use the host-side throttling proxy. */
async function throttle(kbps: number | 'full') {
  note('network speed', { kbps });
  await dev.consoleCommand(kbps === 'full' ? 'network speed full' : `network speed ${kbps}:${kbps}`);
}

// ------------------------------------------------------------------------------------------------ scenarios

async function airplane(run: number) {
  await dev.sh('cmd connectivity airplane-mode enable');
  note('airplane on', { setting: (await dev.sh('settings get global airplane_mode_on')).trim() });
  const down = await waitFor(async () => !(await pingHost()), 30_000, 1000);
  note('network really down (ping to the host fails)', { down });
  const photos = [];
  for (let i = 0; i < 3; i++) photos.push(await plant(2 * MiB, `air-${nonce}-${run}-photo-${i}`, 'image/jpeg'));
  const video = await plant(48 * MiB, `air-${nonce}-${run}-video`, 'video/mp4');
  const planted = [...photos, video];
  note('enqueued offline', { files: planted.length });
  await dev.sleep(15_000);
  const offline = await jobsBySha(planted);
  note(
    'state while offline',
    offline.map((j) => ({ state: j?.state, retries: j?.retries ?? 0, stops: j?.stops ?? 0 })),
  );
  const tOn = Date.now();
  await dev.sh('cmd connectivity airplane-mode disable');
  note('airplane off');
  const ok = await waitFor(() => allUploaded(planted), 300_000, 1500);
  const msToAll = Date.now() - tOn;
  note('all uploaded?', { ok, msAfterNetworkBack: msToAll });
  return { ok, msAfterNetworkBack: msToAll, files: await verifyAll(planted), offlineStates: offline.map((j) => j?.state) };
}

/** Network lost in the MIDDLE of a transfer (airplane mode while a part is in flight), then restored. */
async function airplaneMid(mib: number) {
  await throttle(24_000);
  const p = await plant(mib * MiB, `airmid-${nonce}`, 'video/mp4');
  await waitFor(async () => partsDone((await jobsBySha([p]))[0]) >= 3, 300_000, 400);
  await dev.sh('cmd connectivity airplane-mode enable');
  note('airplane on mid-upload', { partsDone: partsDone((await jobsBySha([p]))[0]) });
  await waitFor(async () => !(await pingHost()), 30_000, 500);
  await dev.sleep(45_000);
  const during = (await jobsBySha([p]))[0];
  note('45 s offline', {
    partsDone: partsDone(during),
    retries: during?.retries,
    stops: during?.stops,
    runs: during?.runs,
    jobScheduler: await dev.jobState(during!.assetId),
  });
  const tOn = Date.now();
  await dev.sh('cmd connectivity airplane-mode disable');
  note('airplane off');
  await throttle('full');
  const ok = await waitFor(() => allUploaded([p]), 300_000, 1500);
  note('uploaded?', { ok, msAfterNetworkBack: Date.now() - tOn });
  return { ok, msAfterNetworkBack: Date.now() - tOn, files: await verifyAll([p]) };
}

/** AC1: camera -> app sandbox -> queue -> S3, driven by Maestro (virtualscene camera of the AVD; muted video; no gallery). */
async function cameraFlow() {
  // async spawn: the issuer lives in this process and must keep answering while Maestro drives the app
  const exitCode = await new Promise<number | null>((resolve) => {
    spawn(process.execPath, ['scripts/maestro.ts', '../app/maestro/capture.yaml'], { stdio: 'inherit' }).on('close', resolve);
  });
  const maestro = { status: exitCode };
  note('Maestro flow finished', { exitCode });
  const ok = await waitFor(
    async () => {
      const jobs = await dev.readJobs();
      return jobs.length >= 2 && jobs.every((j) => j.state === 'uploaded');
    },
    180_000,
    1500,
  );
  const jobs = await dev.readJobs();
  const files = [];
  for (const j of jobs) {
    const rec = issuer.sessions().find((x) => x.assetId === j.assetId);
    const stored = rec ? await objectSha256(s3, local.bucket, rec.key) : undefined;
    files.push({
      assetId: j.assetId,
      contentType: rec?.contentType,
      ok: stored?.sha256 === j.sha256 && stored?.size === j.size,
      sizeBytes: j.size,
      objectShaMatchesDevice: stored?.sha256 === j.sha256,
      uploadMs: j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : undefined,
      retries: j.retries ?? 0,
      partPuts: j.partPuts ?? 0,
    });
  }
  const mediaStore = {
    images: await safe(() => dev.sh('content query --uri content://media/external/images/media --projection _display_name 2>&1 | head -3')),
    video: await safe(() => dev.sh('content query --uri content://media/external/video/media --projection _display_name 2>&1 | head -3')),
  };
  const cache = await safe(() => dev.runAs('ls -la cache/Camera 2>&1 | head -8'));
  return { ok: ok && maestro.status === 0, maestroExit: maestro.status, files, mediaStore, cacheCameraDir: cache };
}

async function interrupt(mode: 'forcestop' | 'kill9', point: 'begin' | 'middle' | 'end', mib: number) {
  await throttle(24_000); // ~3 MB/s so that a part takes a few seconds and the cut can hit a chosen part
  const p = await plant(mib * MiB, `${mode}-${point}-${nonce}`, 'video/mp4');
  const target = point === 'begin' ? 1 : point === 'middle' ? 7 : 12;
  const reached = await waitFor(async () => partsDone((await jobsBySha([p]))[0]) >= target, 300_000, 400);
  const before = (await jobsBySha([p]))[0];
  note(`reached part ${target}?`, { reached, partsDone: partsDone(before) });
  const pid = await dev.pidOfApp();
  if (mode === 'forcestop') await dev.sh(`am force-stop ${dev.PKG}`);
  else await dev.sh(`run-as ${dev.PKG} kill -9 ${pid}`);
  note(`${mode} executed`, { pid: pid ? 'present' : 'none' });
  await dev.sleep(8000);
  const afterKill = (await jobsBySha([p]))[0];
  const stateKill = await dev.jobState(afterKill!.assetId);
  note('after kill (no app launched)', { jobScheduler: stateKill, partsDone: partsDone(afterKill), runs: afterKill?.runs });
  await dev.sleep(20_000);
  const later = (await jobsBySha([p]))[0];
  const continuedWithoutApp = partsDone(later) > partsDone(afterKill) || later?.state === 'uploaded';
  note('20 s later, still without opening the app', { partsDone: partsDone(later), continuedWithoutApp });
  await dev.startApp(); // user opens the app: ensureScheduled() re-creates cancelled jobs
  note('app reopened');
  const ok = await waitFor(() => allUploaded([p]), 300_000, 1500);
  note('uploaded after reopen?', { ok });
  return { ok, point, mode, jobSchedulerAfterKill: stateKill, continuedWithoutApp, files: await verifyAll([p]) };
}

async function killComplete() {
  await throttle('full');
  const p = await plant(80 * MiB, `killcomplete-${nonce}`, 'video/mp4', true);
  const gone = await waitFor(async () => (await dev.pidOfApp()) === '', 120_000, 500);
  const j1 = (await jobsBySha([p]))[0];
  note('process killed by the test hook after complete (before the local state write)', { gone, localState: j1?.state });
  const rec = issuer.sessions().find((s) => s.assetId === j1?.assetId);
  note('server side', { completed: rec?.completed });
  await dev.startApp();
  const ok = await waitFor(() => allUploaded([p]), 120_000, 1000);
  note('local state after restart', { ok });
  return { ok, killedWithLocalState: j1?.state, files: await verifyAll([p]) };
}

async function big(mib: number) {
  await throttle('full');
  const free0 = await dev.freeKb();
  const p = await plant(mib * MiB, `big-${nonce}`, 'video/mp4');
  const free1 = await dev.freeKb();
  note('planted', { mib, freeKbBefore: free0, freeKbAfter: free1 });
  const started = Date.now();
  const ok = await waitFor(() => allUploaded([p]), 1_800_000, 2000);
  note('uploaded?', { ok, ms: Date.now() - started });
  return { ok, bytes: p.size, hostMs: Date.now() - started, freeKbBefore: free0, freeKbAfter: free1, files: await verifyAll([p]) };
}

async function rebootScenario(withPin: boolean) {
  await throttle('full');
  if (withPin) {
    await dev.sh('locksettings set-pin 4321');
    note('synthetic PIN set (removed at the end)');
  }
  const p = await plant(300 * MiB, `reboot-${withPin ? 'pin' : 'nopin'}-${nonce}`, 'video/mp4');
  await throttle(24_000);
  await waitFor(async () => partsDone((await jobsBySha([p]))[0]) >= 4, 300_000, 400);
  const before = (await jobsBySha([p]))[0];
  note('before reboot', { partsDone: partsDone(before) });
  await dev.adb('reboot');
  await dev.sleep(15_000);
  await dev.waitForBoot();
  note('booted');
  await dev.sleep(10_000);
  // State before the first unlock (with a PIN): credential-encrypted storage is not available, so the job cannot read its files.
  const stillLocked = withPin ? (await dev.sh('dumpsys window | grep -c mDreamingLockscreen || true')).trim() : 'n/a';
  const readable = (await dev.readJobs()).length;
  note('before first unlock / without opening the app', { jobsReadableViaRunAs: readable, lockscreenInfo: stillLocked });
  const progress1 = partsDone((await jobsBySha([p]))[0]);
  await dev.sleep(15_000);
  const progress2 = partsDone((await jobsBySha([p]))[0]);
  note('progress without unlock', { progress1, progress2 });
  if (withPin) {
    await dev.sh('input keyevent 82');
    await dev.sleep(1000);
    await dev.sh('input text 4321');
    await dev.sh('input keyevent 66');
    note('unlocked');
  }
  await dev.sleep(20_000);
  const resumedWithoutApp =
    partsDone((await jobsBySha([p]))[0]) > Math.max(progress1, progress2) || (await jobsBySha([p]))[0]?.state === 'uploaded';
  note('resumed without opening the app?', { resumedWithoutApp, jobScheduler: await dev.jobState(before!.assetId) });
  if (!resumedWithoutApp) {
    await dev.startApp();
    note('app opened');
  }
  await throttle('full');
  const ok = await waitFor(() => allUploaded([p]), 300_000, 1500);
  if (withPin) await dev.sh('locksettings clear --old 4321');
  return { ok, withPin, resumedWithoutApp, progressBeforeUnlock: [progress1, progress2], files: await verifyAll([p]) };
}

let proxy: ThrottleProxy | undefined;

/** Long scenario: the S3 traffic goes through a host-side rate-limiting proxy (:8334) so that the transfer outlasts 10 minutes. */
async function background(mib: number, kBps: number, deepIdle: boolean) {
  proxy = createThrottleProxy({ listenPort: 8334, targetPort: 8333, bytesPerSecond: kBps * 1000 });
  await proxy.listen();
  note('throttling proxy on the host', { kBps });
  const p = await plant(mib * MiB, `bg-${deepIdle ? 'idle' : 'base'}-${nonce}`, 'video/mp4');
  await dev.sleep(5000);
  note('effective path', { wifiOn: (await dev.sh('dumpsys wifi | grep -m1 "Wi-Fi is"')).trim() });
  await dev.sh('input keyevent KEYCODE_HOME');
  note('app sent to background (HOME)');
  if (deepIdle) {
    await dev.sh('dumpsys battery unplug');
    await dev.sh('dumpsys deviceidle force-idle');
    await dev.sh(`am set-standby-bucket ${dev.PKG} restricted`);
    note('FORCED idle + restricted standby bucket', { bucket: (await dev.sh(`am get-standby-bucket ${dev.PKG}`)).trim() });
  }
  const samples: { tMs: number; partsDone: number; state?: string }[] = [];
  const start = Date.now();
  let finished = false;
  while (Date.now() - start < 14 * 60_000 && !finished) {
    await dev.sleep(30_000);
    const j = (await jobsBySha([p]))[0];
    samples.push({ tMs: Date.now() - start, partsDone: partsDone(j), state: j?.state });
    finished = j?.state === 'uploaded';
  }
  note('background phase over', { finished, minutes: ((Date.now() - start) / 60_000).toFixed(1) });
  if (deepIdle) {
    await dev.sh('dumpsys deviceidle unforce');
    await dev.sh('dumpsys battery reset');
  }
  const ok = finished || (await waitFor(() => allUploaded([p]), 600_000, 2000));
  note('proxy bytes forwarded', { bytesUp: proxy.bytesUp() });
  await proxy.close();
  return { ok, deepIdle, backgroundMs: Date.now() - start, samples, files: await verifyAll([p]) };
}

async function wifiLte() {
  await throttle(24_000);
  const p = await plant(160 * MiB, `wifi-${nonce}`, 'video/mp4');
  await waitFor(async () => partsDone((await jobsBySha([p]))[0]) >= 2, 120_000, 400);
  note('mid-upload', { partsDone: partsDone((await jobsBySha([p]))[0]) });
  await dev.sh('svc wifi disable');
  note('wifi disabled (the emulator falls back to its emulated cellular data; this is only an approximation of Wi-Fi <-> LTE)');
  await dev.sleep(15_000);
  note('15 s after the switch', { partsDone: partsDone((await jobsBySha([p]))[0]) });
  await dev.sh('svc wifi enable');
  note('wifi enabled');
  await throttle('full');
  const ok = await waitFor(() => allUploaded([p]), 300_000, 1500);
  return { ok, approximationOnly: true, files: await verifyAll([p]) };
}

const safe = async (fn: () => Promise<string>) => {
  try {
    return (await fn()).trim();
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return `(exit != 0) ${(err.stdout || err.stderr || err.message).toString().trim().slice(0, 300)}`;
  }
};

async function checks() {
  const out: Record<string, unknown> = {};
  // Put something into the queue so that the encrypted database and the job files exist.
  const p = await plant(1 * MiB, `checks-${nonce}`, 'image/jpeg');
  out.smokeUploaded = await waitFor(() => allUploaded([p]), 60_000, 1000);
  // A1 (b): backup attempt on the emulator.
  out.bmgrEnabled = await safe(() => dev.sh('bmgr enabled'));
  out.bmgrBackupnow = await safe(() => dev.sh(`bmgr backupnow ${dev.PKG} 2>&1 | head -5`));
  // Database must not be readable plaintext: first bytes of the SQLCipher file are not "SQLite format 3".
  const head = await safe(() => dev.adb('exec-out', `run-as ${dev.PKG} sh -c 'head -c 16 files/SQLite/evm011-queue.db | od -An -tx1'`));
  out.dbHeaderHex = head;
  out.dbLooksPlainSqlite = head.replace(/\s+/g, '') === '53514c69746520666f726d6174203300';
  out.dbFiles = await safe(() => dev.runAs('ls -la files/SQLite databases 2>&1'));
  out.noBackupFiles = await safe(() => dev.runAs('ls -R no_backup/evm011 2>&1 | head -20'));
  out.mediaDir = await safe(() => dev.runAs('ls -la files/media 2>&1 | head -20'));
  out.mediaStoreVideoRows = await safe(() =>
    dev.sh('content query --uri content://media/external/video/media --projection _display_name 2>&1 | head -3'),
  );
  out.mediaStoreImageRows = await safe(() =>
    dev.sh('content query --uri content://media/external/images/media --projection _display_name 2>&1 | head -3'),
  );
  out.grantedPermissions = await safe(() => dev.sh(`dumpsys package ${dev.PKG} | grep -E "permission.*granted=true" | head -20`));
  out.requestedPermissions = await safe(() =>
    dev.sh(`dumpsys package ${dev.PKG} | sed -n '/requested permissions:/,/install permissions:/p' | head -30`),
  );
  out.adbBackupAttempt = 'see backup scenario in the report';
  return out;
}

// ------------------------------------------------------------------------------------------------ main

if (!(await dev.emulatorRunning())) await dev.startEmulator();
if (scenario !== 'checks' && !args.includes('--keep')) await resetAll();
await startIssuer(3600, scenario.startsWith('background') ? 8334 : 8333);
await configureApp();
const runs = flag('runs', 1);
try {
  switch (scenario) {
    case 'airplane': {
      const all = [];
      for (let r = 1; r <= runs; r++) all.push(await airplane(r));
      await finish('airplane', { runs: all });
      break;
    }
    case 'camera':
      await finish('camera', { run: await cameraFlow() });
      break;
    case 'airplane-mid':
      await finish('airplane-mid', { run: await airplaneMid(flag('mib', 200)) });
      break;
    case 'forcestop':
    case 'kill9': {
      const all = [];
      for (const point of ['begin', 'middle', 'end'] as const) all.push(await interrupt(scenario, point, flag('mib', 200)));
      await finish(scenario, { runs: all });
      break;
    }
    case 'killcomplete':
      await finish('killcomplete', { run: await killComplete() });
      break;
    case 'big':
      await finish('big', { run: await big(flag('mib', 512)) });
      break;
    case 'reboot':
      await finish('reboot', { run: await rebootScenario(false) });
      break;
    case 'reboot-pin':
      await finish('reboot-pin', { run: await rebootScenario(true) });
      break;
    case 'background':
      await finish('background', { run: await background(flag('mib', 256), flag('kBps', 350), false) });
      break;
    case 'background-idle':
      await finish('background-idle', { run: await background(flag('mib', 256), flag('kBps', 350), true) });
      break;
    case 'wifi-lte':
      await finish('wifi-lte', { run: await wifiLte() });
      break;
    case 'checks':
      await finish('checks', { checks: await checks() });
      break;
    default:
      console.error('unknown scenario');
      process.exitCode = 2;
  }
} finally {
  await issuer.close();
}
