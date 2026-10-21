// Helper for the PHYSICAL-PHONE scenario (AC2 phone part, AC5), run by Konrad over USB. Usage:
//   node scripts/phone.ts info        model, Android version, security patch, free space (for the report)
//   node scripts/phone.ts configure   adb reverse (USB only, no LAN) + hands the test token to the app (never printed)
//   node scripts/phone.ts status      table of queue items with state and counters (read from the app sandbox via run-as)
//   node scripts/phone.ts export      writes .scratch/EVM-011/results/phone-export.json: [{assetId,size,sha256}] (no URLs, no token)
// The issuer must be started with: node scripts/issuer-cli.ts --sign-endpoint http://127.0.0.1:8333
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR, loadLocal } from '../src/local.ts';
import * as dev from './lib/device.ts';

const cmd = process.argv[2];

if (cmd === 'info') {
  const props = [
    'ro.product.manufacturer',
    'ro.product.model',
    'ro.build.version.release',
    'ro.build.version.sdk',
    'ro.build.version.security_patch',
  ];
  for (const p of props) console.log(p, (await dev.sh(`getprop ${p}`)).trim());
  console.log('free /data (KiB):', await dev.freeKb());
  console.log('battery:', (await dev.sh('dumpsys battery | grep -E "level|status|powered"')).trim().replace(/\s+/g, ' '));
} else if (cmd === 'configure') {
  // adb reverse keeps the traffic on the USB cable: the phone reaches 127.0.0.1:8787 (issuer) and 127.0.0.1:8333 (S3) on this PC only.
  await dev.adb('reverse', 'tcp:8787', 'tcp:8787');
  await dev.adb('reverse', 'tcp:8333', 'tcp:8333');
  await dev.sh(`pm grant ${dev.PKG} android.permission.CAMERA`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.POST_NOTIFICATIONS`);
  await dev.startApp({ cmd: 'configure', token: loadLocal().token, base: 'http://127.0.0.1:8787', device: 'phone-1' });
  console.log('configured; reverse tunnels:', (await dev.adb('reverse', '--list')).trim().replace(/\s+/g, ' '));
} else if (cmd === 'status') {
  const jobs = await dev.readJobs();
  for (const j of jobs) {
    const parts = Object.keys(j.etags ?? {}).length;
    const ms = j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : '';
    console.log(
      [
        j.assetId.slice(-8),
        j.state.padEnd(15),
        `${(j.size / 1048576).toFixed(1)} MiB`,
        `parts ${parts}/${j.partCount ?? '?'}`,
        `retries ${j.retries ?? 0}`,
        `renewals ${j.renewals ?? 0}`,
        `stops ${j.stops ?? 0}`,
        `runs ${j.runs ?? 0}`,
        `ms ${ms}`,
      ].join(' | '),
    );
  }
  console.log(`${jobs.length} items, uploaded ${jobs.filter((j) => j.state === 'uploaded').length}`);
} else if (cmd === 'export') {
  const jobs = await dev.readJobs();
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, 'phone-export.json');
  writeFileSync(
    file,
    JSON.stringify(
      jobs.map((j) => ({
        assetId: j.assetId,
        size: j.size,
        sha256: j.sha256,
        state: j.state,
        retries: j.retries ?? 0,
        renewals: j.renewals ?? 0,
        stops: j.stops ?? 0,
        runs: j.runs ?? 0,
        uploadMs: j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : null,
      })),
      null,
      2,
    ),
  );
  console.log(`written ${file}`);
} else {
  console.error('usage: phone.ts info | configure | status | export');
  process.exitCode = 2;
}
