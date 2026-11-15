import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PORT } from '../src/commands.mjs';
import { main, parseArguments, USAGE } from '../src/main.mjs';

describe('arguments of the smoke test (EVM-009 AC4)', () => {
  it('EVM-009 AC4: no arguments mean a full run on the default port', () => {
    assert.deepEqual(parseArguments([]), { skipBuild: false, port: DEFAULT_PORT });
  });

  it('EVM-009 AC4: --skip-build and --port are accepted in any order', () => {
    assert.deepEqual(parseArguments(['--skip-build']), { skipBuild: true, port: DEFAULT_PORT });
    assert.deepEqual(parseArguments(['--port', '4000', '--skip-build']), { skipBuild: true, port: 4000 });
  });

  it('EVM-009 AC4: an unknown argument or an unusable port is refused', () => {
    for (const argv of [
      ['--unknown'],
      ['--port'],
      ['--port', 'abc'],
      ['--port', '80'],
      ['--port', '70000'],
      ['--port', '3000x'],
      ['stray'],
    ]) {
      assert.equal(parseArguments(argv), null, argv.join(' '));
    }
  });

  it('EVM-009 AC4: unusable arguments print the usage and exit with 2 without touching the machine', async () => {
    /** @type {string[]} */
    const logs = [];
    const host = /** @type {import('../src/run.mjs').Host} */ (
      /** @type {unknown} */ ({ log: (/** @type {string} */ line) => logs.push(line) })
    );
    assert.equal(await main(['--nope'], host), 2);
    assert.deepEqual(logs, [USAGE]);
  });
});

describe('selection of the scenarios (EVM-130 stage C)', () => {
  it('EVM-130 AC1: --only takes names or prefixes of scenario names, separated by commas, in any position', () => {
    assert.deepEqual(parseArguments(['--only', 'upload-']), { skipBuild: false, port: DEFAULT_PORT, only: ['upload-'] });
    assert.deepEqual(parseArguments(['--skip-build', '--only', 'online,upload-device-wipe']), {
      skipBuild: true,
      port: DEFAULT_PORT,
      only: ['online', 'upload-device-wipe'],
    });
  });

  it('EVM-130 AC1: --only without a usable value is refused', () => {
    for (const argv of [['--only'], ['--only', ''], ['--only', 'UPPER'], ['--only', 'a,,b'], ['--only', 'a b'], ['--only', 'a,']])
      assert.equal(parseArguments(argv), null, argv.join(' '));
  });

  it('EVM-130 AC1: the usage names --only', () => {
    assert.match(USAGE, /--only/);
  });
});
