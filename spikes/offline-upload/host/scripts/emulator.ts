// Usage: node scripts/emulator.ts start | kill | install <apk> | grant
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
} else {
  console.error('usage: emulator.ts start | kill | install <apk>');
  process.exitCode = 2;
}
