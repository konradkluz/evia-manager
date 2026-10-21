// Usage: node scripts/emulator.ts start | kill | install <apk> | reset
import * as dev from './lib/device.ts';

const [cmd, apk] = process.argv.slice(2);
if (cmd === 'start') {
  await dev.startEmulator();
  console.log(
    'emulator booted:',
    (await dev.sh('getprop ro.build.version.release')).trim(),
    'API',
    (await dev.sh('getprop ro.build.version.sdk')).trim(),
  );
} else if (cmd === 'kill') {
  await dev.killEmulator();
} else if (cmd === 'install') {
  console.log(await dev.adb('install', '-r', apk ?? ''));
  await dev.sh(`pm grant ${dev.PKG} android.permission.CAMERA`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.POST_NOTIFICATIONS`);
} else if (cmd === 'reset') {
  await dev.sh(`pm clear ${dev.PKG}`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.CAMERA`);
  await dev.sh(`pm grant ${dev.PKG} android.permission.POST_NOTIFICATIONS`);
  console.log('app data cleared, permissions granted');
} else {
  console.error('usage: emulator.ts start | kill | install <apk> | reset');
  process.exitCode = 2;
}
