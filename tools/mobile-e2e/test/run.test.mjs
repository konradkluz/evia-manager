import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runE2e } from '../src/run.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';

const DEVICES_ONE = 'List of devices attached\nemulator-5554\tdevice\n';
const DEVICES_NONE = 'List of devices attached\n';
const DEVICES_TWO = 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n';

/**
 * A fake machine: every process is recorded, answers come from `responder`.
 * @param {{
 *   devices?: string[],
 *   failing?: (command: string, args: string[]) => boolean,
 *   exists?: (path: string) => boolean,
 *   requests?: { platform: string | undefined, version: string | undefined }[],
 *   pid?: string,
 *   longPaths?: boolean | null,
 *   env?: Record<string, string>,
 * }} [options]
 */
function fakeMachine({ devices = [DEVICES_ONE], failing = () => false, exists, requests, pid = '4242', longPaths = true, env } = {}) {
  /** @type {{ command: string, args: string[], cwd?: string, env?: Record<string, string> }[]} */
  const processes = [];
  /** @type {string[]} */
  const logs = [];
  /** @type {Record<string, string>} */
  const written = {};
  /** @type {string[]} */
  const modes = [];
  let closed = false;
  let devicePolls = 0;
  /** @type {{ command: string, args: string[] }[]} */
  const detached = [];
  let stubPort = 0;
  const apk = join('/repo', 'apps', 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  let built = false;

  const host = /** @type {import('../src/run.mjs').Host} */ ({
    repoRoot: '/repo',
    platform: 'win32',
    env: { ANDROID_HOME: '/sdk', JAVA_HOME: '/jdk', EVIA_MAESTRO_HOME: '/m', GITHUB_TOKEN: 'synthetic-token', ...env },
    homedir: '/home/test',
    execPath: 'node',
    exists: (path) => (exists === undefined ? path !== apk || built : exists(path)),
    writeText: (path, text) => {
      written[path] = text;
    },
    makeDirectory: () => undefined,
    run: (command, args, options = {}) => {
      processes.push({
        command,
        args,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      const joined = args.join(' ');
      if (failing(command, args)) return { status: 1, stdout: '', stderr: 'failed' };
      if (command.includes('adb')) {
        if (joined === 'devices') {
          const answer = devices[Math.min(devicePolls, devices.length - 1)] ?? DEVICES_NONE;
          devicePolls += 1;
          return { status: 0, stdout: answer, stderr: '' };
        }
        if (joined.endsWith('sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '' };
        if (joined.endsWith('ro.build.version.sdk')) return { status: 0, stdout: '35\n', stderr: '' };
        if (joined.endsWith('ro.build.version.release')) return { status: 0, stdout: '15\n', stderr: '' };
        if (joined.endsWith('ro.product.model')) return { status: 0, stdout: 'sdk_gphone64_x86_64\n', stderr: '' };
        if (joined.endsWith(`pidof pl.eviacharge.manager`)) return { status: 0, stdout: `${pid}\n`, stderr: '' };
        if (joined.includes('logcat')) return { status: 0, stdout: 'I/app: started\nI/app: health checked\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (joined.includes('GradleWrapperMain')) built = true;
      if (joined.endsWith('--version')) return { status: 0, stdout: 'update available\n2.11.0\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    startDetached: (command, args) => {
      detached.push({ command, args });
    },
    sleep: () => Promise.resolve(),
    now: (() => {
      let tick = 0;
      return () => {
        tick += 1500;
        return tick;
      };
    })(),
    longPathsEnabled: () => longPaths,
    resolveExpoCli: () => '/expo/bin/cli',
    readAppVersion: () => '0.1.0',
    startStub: (port) => {
      stubPort = port;
      return Promise.resolve({
        port,
        setMode: (mode) => {
          modes.push(mode);
        },
        requests: () => requests ?? [{ platform: 'android', version: '0.1.0' }],
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      });
    },
    log: (line) => {
      logs.push(line);
    },
    today: () => '2026-10-20',
  });
  return {
    host,
    processes,
    logs,
    written,
    modes,
    detached,
    isClosed: () => closed,
    stubPort: () => stubPort,
    maestroFlows: () =>
      processes
        .filter((entry) => entry.args.includes('test'))
        .map((entry) => entry.args[entry.args.indexOf('test') + 1]?.split(/[\\/]/).at(-1)),
    airplane: () => processes.filter((entry) => entry.args.includes('airplane-mode')).map((entry) => entry.args.at(-1)),
  };
}

/**
 * @template T
 * @param {T | undefined} value
 * @returns {T}
 */
function must(value) {
  assert.ok(value !== undefined);
  return value;
}

const ALL_FLOWS = SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.flow));

describe('smoke test run (EVM-009 AC4; ADR-0015)', () => {
  it('EVM-009 AC4: builds the e2e variant, installs on the emulator, runs every flow and reports green', async () => {
    const machine = fakeMachine();
    const code = await runE2e({ skipBuild: false, port: 3199 }, machine.host);
    assert.equal(code, 0, machine.logs.join('\n'));
    const prebuild = must(machine.processes.find((entry) => entry.args.includes('prebuild')));
    const gradle = must(machine.processes.find((entry) => entry.args.includes('assembleRelease')));
    const install = must(machine.processes.find((entry) => entry.args.includes('install')));
    assert.deepEqual(prebuild.args.slice(0, 2), ['/expo/bin/cli', 'prebuild']);
    assert.equal(prebuild.env?.['EVIA_BUILD_VARIANT'], 'e2e');
    assert.equal(prebuild.env['EXPO_PUBLIC_API_BASE_URL'], 'http://10.0.2.2:3199');
    assert.ok(gradle.args.includes('assembleRelease'));
    assert.deepEqual(install.args.slice(0, 4), ['-s', 'emulator-5554', 'install', '-r']);
    assert.deepEqual(machine.maestroFlows(), ALL_FLOWS);
    assert.equal(machine.isClosed(), true);
    assert.equal(machine.stubPort(), 3199);
  });

  it('EVM-009 AC4: no token of the host reaches any process', async () => {
    const machine = fakeMachine();
    await runE2e({ skipBuild: false, port: 3199 }, machine.host);
    for (const entry of machine.processes) assert.equal(entry.env?.['GITHUB_TOKEN'], undefined);
    assert.ok(machine.processes.every((entry) => entry.env?.['EXPO_NO_TELEMETRY'] === '1'));
  });

  it('EVM-009 AC4: the scenario server and the airplane mode follow the scenarios', async () => {
    const machine = fakeMachine({ exists: () => true });
    await runE2e({ skipBuild: true, port: 3199 }, machine.host);
    assert.deepEqual(
      machine.modes,
      SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.server)),
    );
    // airplane on for the offline flow, off before the return (and nothing else)
    assert.deepEqual(machine.airplane(), ['enable', 'disable']);
    const homeIndex = machine.processes.findIndex((entry) => entry.args.includes('KEYCODE_HOME'));
    assert.ok(homeIndex > 0, 'the app goes to the background before the reconnect flow');
  });

  it('EVM-009 AC4: the report is written with the emulator API level and the Maestro version', async () => {
    const machine = fakeMachine({ exists: () => true });
    await runE2e({ skipBuild: true, port: 3199 }, machine.host);
    const report = machine.written[join('/repo', '.scratch', 'mobile-e2e', 'report.md')];
    assert.match(report ?? '', /API 35/);
    assert.match(report ?? '', /Maestro: 2\.11\.0/);
    assert.match(report ?? '', /6 passed, 0 failed, 0 skipped/);
    assert.ok(machine.logs.some((line) => line.includes('Maestro smoke test')));
  });

  it('EVM-009 AC4: --skip-build uses the APK of the earlier build', async () => {
    const machine = fakeMachine({ exists: () => true });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0);
    assert.ok(!machine.processes.some((entry) => entry.args.includes('prebuild') || entry.args.includes('assembleRelease')));
  });

  it('EVM-009 AC4: a missing prerequisite stops before any process starts', async () => {
    const machine = fakeMachine({ longPaths: false });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.deepEqual(machine.processes, []);
    assert.match(machine.logs.join('\n'), /PREFLIGHT: .*LongPathsEnabled/);
  });

  it('EVM-009 AC4: a Java without JAVA_HOME is looked up on the PATH, not as a file', async () => {
    const machine = fakeMachine({ env: { JAVA_HOME: '' }, exists: (path) => !path.endsWith('app-release.apk') || true });
    machine.host.env['JAVA_HOME'] = undefined;
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, machine.host), 0);
  });

  it('EVM-009 AC4: more than one emulator is a refusal and nothing is built', async () => {
    const machine = fakeMachine({ devices: [DEVICES_TWO] });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.match(machine.logs.join('\n'), /more than one emulator/);
    assert.ok(!machine.processes.some((entry) => entry.args.includes('prebuild')));
  });

  it('EVM-009 AC4: without a running emulator the AVD is started and awaited, once', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE, DEVICES_NONE, DEVICES_ONE] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 0);
    assert.equal(machine.detached.length, 1);
    assert.deepEqual(machine.detached[0]?.args, ['-avd', 'Medium_Phone_API_35', '-no-snapshot-save', '-no-boot-anim']);
  });

  it('EVM-009 AC4: a second emulator appearing while the first starts is a refusal', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE, DEVICES_TWO] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.match(machine.logs.join('\n'), /second emulator/);
  });

  it('EVM-009 AC4: an emulator that never boots ends the run with a clear message', async () => {
    const machine = fakeMachine({ devices: [DEVICES_NONE] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.match(machine.logs.join('\n'), /not ready after 180 s/);
  });

  it('EVM-009 AC4: a failing prebuild, Gradle build or a missing APK ends the run before the install', async () => {
    for (const [name, failing, exists] of /** @type {const} */ ([
      ['prebuild', (/** @type {string} */ _c, /** @type {string[]} */ args) => args.includes('prebuild'), undefined],
      ['Gradle', (/** @type {string} */ _c, /** @type {string[]} */ args) => args.includes('assembleRelease'), undefined],
      ['no APK', () => false, (/** @type {string} */ path) => !path.endsWith('app-release.apk')],
    ])) {
      const machine = fakeMachine({ failing, ...(exists === undefined ? {} : { exists }) });
      assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1, name);
      assert.match(machine.logs.join('\n'), /BUILD:/, name);
      assert.ok(!machine.processes.some((entry) => entry.args.includes('install')), name);
    }
  });

  it('EVM-009 AC4: a failed install ends the run, switches nothing on and closes the server', async () => {
    const machine = fakeMachine({ failing: (_c, args) => args.includes('install') });
    assert.equal(await runE2e({ skipBuild: false, port: 3199 }, machine.host), 1);
    assert.match(machine.logs.join('\n'), /INSTALL:/);
    assert.equal(machine.isClosed(), true);
    assert.deepEqual(machine.maestroFlows(), []);
  });

  it('EVM-009 AC4: a failing flow skips the rest of its scenario, the other scenarios still run, and airplane mode is switched off', async () => {
    const machine = fakeMachine({ failing: (_c, args) => args.some((argument) => argument.endsWith('02-offline.yaml')) });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
    assert.ok(!machine.maestroFlows().includes('03-reconnect.yaml'));
    assert.ok(machine.maestroFlows().includes('04-update-required.yaml'));
    assert.deepEqual(machine.airplane(), ['enable', 'disable']);
    const report = Object.values(machine.written).join('\n');
    assert.match(report, /\| airplane-mode-and-return \| 02-offline\.yaml \| failed \|/);
    assert.match(report, /\| airplane-mode-and-return \| 03-reconnect\.yaml \| skipped \|/);
  });

  it('EVM-009 AC4: no compatibility header on the requests makes the run red even when every flow passed', async () => {
    const machine = fakeMachine({ requests: [{ platform: undefined, version: undefined }] });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 1);
  });

  it('EVM-009 AC4: an app process that is not running leaves the log uncollected, not invented', async () => {
    const machine = fakeMachine({ pid: '' });
    assert.equal(await runE2e({ skipBuild: true, port: 3199 }, { ...machine.host, exists: () => true }), 0);
    assert.match(Object.values(machine.written).join('\n'), /Logcat of the app process: not collected/);
  });

  it('EVM-009 AC4: the default SDK folder is the Windows user one, or ~/Android/Sdk elsewhere', async () => {
    const windows = fakeMachine({ env: { ANDROID_HOME: '' } });
    windows.host.env['ANDROID_HOME'] = undefined;
    windows.host.env['LOCALAPPDATA'] = 'C:/Users/T/AppData/Local';
    await runE2e({ skipBuild: true, port: 3199 }, { ...windows.host, exists: () => true });
    assert.ok(windows.processes.some((entry) => entry.command.startsWith(join('C:/Users/T/AppData/Local', 'Android', 'Sdk'))));
    const noLocalAppData = fakeMachine();
    noLocalAppData.host.env['ANDROID_HOME'] = undefined;
    await runE2e({ skipBuild: true, port: 3199 }, { ...noLocalAppData.host, exists: () => true });
    assert.ok(noLocalAppData.processes.some((entry) => entry.command.startsWith(join('/home/test', 'Android', 'Sdk'))));
    const linux = fakeMachine();
    linux.host.env['ANDROID_HOME'] = undefined;
    await runE2e({ skipBuild: true, port: 3199 }, { ...linux.host, platform: 'linux', exists: () => true });
    assert.ok(linux.processes.some((entry) => entry.command.startsWith(join('/home/test', 'Android', 'Sdk'))));
  });
});
