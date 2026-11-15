import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { main, parseGradleArguments, USAGE } from '../src/main.mjs';

const SEPARATOR = '------------------------------------------------------------';
/** @param {string} project @param {string[]} lines */
const report = (project, lines) =>
  [
    `> Task ${project}:dependencies`,
    '',
    SEPARATOR,
    `Project '${project}'`,
    SEPARATOR,
    '',
    'releaseRuntimeClasspath - x',
    ...lines,
    '',
    '',
  ].join('\n');
const CLEAN = `${report(':app', ['\\--- androidx.core:core:1.18.0'])}\n${report(':expo-camera', ['\\--- androidx.core:core:1.18.0'])}`;

/** @param {Record<string, string>} files */
function host(files) {
  /** @type {string[]} */
  const logs = [];
  return {
    logs,
    host: /** @type {import('../src/main.mjs').Host} */ (
      /** @type {unknown} */ ({
        env: {},
        platform: 'linux',
        readFile: (/** @type {string} */ path) => {
          const text = files[path];
          if (text === undefined) throw new Error('ENOENT: secret-looking-path');
          return new TextEncoder().encode(text);
        },
        log: (/** @type {string} */ line) => {
          logs.push(line);
        },
      })
    ),
  };
}

describe('commands deps and mapping of the Gradle checks (EVM-108 AC8)', () => {
  it('EVM-108 AC8: the arguments are a command and one file; anything else is refused', () => {
    assert.deepEqual(parseGradleArguments(['deps', '--file', 'a.txt']), { command: 'deps', file: 'a.txt' });
    assert.deepEqual(parseGradleArguments(['mapping', '--file', 'm.txt']), { command: 'mapping', file: 'm.txt' });
    for (const argv of [
      [],
      ['verify', '--file', 'a'],
      ['deps'],
      ['deps', '--file'],
      ['deps', '--file', ''],
      ['deps', '--file', '--x'],
      ['deps', '--file', 'a', '--x'],
      ['deps', 'a'],
    ]) {
      assert.equal(parseGradleArguments(argv), null, argv.join(' '));
    }
  });

  it('EVM-108 AC8: deps exits 0 on a clean tree of both projects and says so', () => {
    const { host: h, logs } = host({ 'deps.txt': CLEAN });
    assert.equal(main(['deps', '--file', 'deps.txt'], h), 0);
    assert.deepEqual(logs, ['Gradle dependencies: no library of a forbidden group in releaseRuntimeClasspath of :app and :expo-camera']);
  });

  it('EVM-108 AC8: deps exits 1 and names the coordinate and the parent when ML Kit is in the tree', () => {
    const tree = `${report(':app', ['\\--- androidx.core:core:1.18.0'])}\n${report(':expo-camera', ['+--- androidx.camera:camera-core:1.6.0', '|    \\--- com.google.mlkit:barcode-scanning:17.3.0'])}`;
    const { host: h, logs } = host({ 'deps.txt': tree });
    assert.equal(main(['deps', '--file', 'deps.txt'], h), 1);
    assert.deepEqual(
      logs,
      [':expo-camera: com.google.mlkit:barcode-scanning in releaseRuntimeClasspath (from androidx.camera:camera-core)'].map(
        (line) => `Gradle: ${line}`,
      ),
    );
  });

  it('EVM-108 AC8: deps with an empty or missing file fails closed with exit code 1, without the system message of the error', () => {
    const empty = host({ 'deps.txt': '' });
    assert.equal(main(['deps', '--file', 'deps.txt'], empty.host), 1);
    assert.deepEqual(empty.logs, ['Gradle: the dependency report is empty']);
    const missing = host({});
    assert.equal(main(['deps', '--file', 'none.txt'], missing.host), 1);
    assert.deepEqual(missing.logs, ['Gradle: the file could not be read']);
  });

  it('EVM-108 AC8: mapping exits 0 on a clean mapping, 1 on a forbidden class, an empty file and a missing file', () => {
    const ok = host({ 'm.txt': '# compiler: R8\na.B -> a.a:\n' });
    assert.equal(main(['mapping', '--file', 'm.txt'], ok.host), 0);
    assert.deepEqual(ok.logs, ['mapping.txt: no class of a forbidden package']);
    const bad = host({ 'm.txt': 'com.google.android.gms.X -> a.a:\n' });
    assert.equal(main(['mapping', '--file', 'm.txt'], bad.host), 1);
    assert.deepEqual(bad.logs, ['mapping.txt: 1 class of com.google.android.gms (for example com.google.android.gms.X)']);
    const empty = host({ 'm.txt': '' });
    assert.equal(main(['mapping', '--file', 'm.txt'], empty.host), 1);
    const missing = host({});
    assert.equal(main(['mapping', '--file', 'm.txt'], missing.host), 1);
    assert.deepEqual(missing.logs, ['mapping.txt: the file could not be read (minification is on: a mapping is required)']);
  });

  it('EVM-108 AC8: the usage names the new commands and a wrong call exits with 2', () => {
    assert.match(USAGE, /deps --file/);
    assert.match(USAGE, /mapping --file/);
    const { host: h, logs } = host({});
    assert.equal(main(['deps'], h), 2);
    assert.deepEqual(logs, [USAGE]);
  });
});
