import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPreflight, LONG_PATHS_REMEDY } from '../src/preflight.mjs';

/** @type {import('../src/preflight.mjs').Facts} */
const READY = {
  platform: 'win32',
  longPathsEnabled: true,
  androidHomeSet: true,
  present: { adb: true, emulator: true, java: true, maestro: true },
  skipBuild: false,
  apkPresent: false,
  shortPaths: false,
};

describe('preflight of the smoke test (EVM-009 AC4)', () => {
  it('EVM-009 AC4: a complete environment has no problems', () => {
    assert.deepEqual(checkPreflight(READY), []);
  });

  it('EVM-009 AC4: every missing tool is named with its remedy', () => {
    const problems = checkPreflight({
      ...READY,
      androidHomeSet: false,
      present: { adb: false, emulator: false, java: false, maestro: false },
    });
    assert.equal(problems.length, 5);
    assert.match(problems.join('\n'), /ANDROID_HOME/);
    assert.match(problems.join('\n'), /adb/);
    assert.match(problems.join('\n'), /emulator/i);
    assert.match(problems.join('\n'), /JAVA_HOME/);
    assert.match(problems.join('\n'), /EVIA_MAESTRO_HOME/);
  });

  it('EVM-009 AC4: Windows long paths off stops the native build early with the remedy (CMake/Ninja 260 characters)', () => {
    for (const longPathsEnabled of [false, null]) {
      assert.deepEqual(checkPreflight({ ...READY, longPathsEnabled }), [LONG_PATHS_REMEDY]);
    }
    assert.match(LONG_PATHS_REMEDY, /LongPathsEnabled/);
    assert.match(LONG_PATHS_REMEDY, /Filename longer than 260/);
    assert.match(LONG_PATHS_REMEDY, /EVIA_ANDROID_CMAKE_VERSION/);
  });

  it('EVM-009 AC4: the remedy names both ways, the administrator and the short clone with a flat node_modules', () => {
    assert.match(LONG_PATHS_REMEDY, /administrator/i);
    assert.match(LONG_PATHS_REMEDY, /EVIA_E2E_SHORT_PATHS=1/);
    assert.match(LONG_PATHS_REMEDY, /nodeLinker: hoisted/);
    assert.match(LONG_PATHS_REMEDY, /@evia\/tokens/);
    assert.match(LONG_PATHS_REMEDY, /@evia\/contracts/);
  });

  it('EVM-009 AC4: EVIA_E2E_SHORT_PATHS skips only the long-path check, other problems stay', () => {
    assert.deepEqual(checkPreflight({ ...READY, longPathsEnabled: false, shortPaths: true }), []);
    assert.deepEqual(checkPreflight({ ...READY, longPathsEnabled: null, shortPaths: true }), []);
    const problems = checkPreflight({ ...READY, longPathsEnabled: false, shortPaths: true, present: { ...READY.present, adb: false } });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /adb/);
  });

  it('EVM-009 AC4: long paths matter only for Windows and only when the app is built', () => {
    assert.deepEqual(checkPreflight({ ...READY, platform: 'linux', longPathsEnabled: null }), []);
    assert.deepEqual(checkPreflight({ ...READY, longPathsEnabled: false, skipBuild: true, apkPresent: true }), []);
  });

  it('EVM-009 AC4: skipping the build needs the APK of an earlier build', () => {
    assert.equal(checkPreflight({ ...READY, skipBuild: true, apkPresent: false }).length, 1);
    assert.match(checkPreflight({ ...READY, skipBuild: true, apkPresent: false })[0] ?? '', /--skip-build/);
  });
});
