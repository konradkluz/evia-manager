import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { processDeps, realHost } from '../src/process.mjs';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const ROOT = join(tmpdir(), 'evia-root');

/**
 * @typedef {import('../src/process.mjs').Host} Host
 * @typedef {{ command: string, args: string[], options: Record<string, unknown> }} Call
 */

/**
 * A fake host that records every call; `overrides` replace single members.
 * @param {Record<string, unknown>} [overrides]
 */
function fakeHost(overrides = {}) {
  /** @type {{ out: string[], err: string[] }} */
  const written = { out: [], err: [] };
  /** @type {{ spawn: Call[], spawnSync: Call[], resolve: string[][], questions: string[] }} */
  const calls = { spawn: [], spawnSync: [], resolve: [], questions: [] };
  const base = {
    env: { PATH: 'x' },
    execPath: '/node',
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write: (/** @type {string} */ text) => {
        written.out.push(text);
        return true;
      },
    },
    stderr: {
      isTTY: false,
      write: (/** @type {string} */ text) => {
        written.err.push(text);
        return true;
      },
    },
    readFile: () => 'CURSOR_KEY=zzkey\nOTHER=1\n',
    spawn: (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {Record<string, unknown>} */ options) => {
      calls.spawn.push({ command, args, options });
      /** @type {EventEmitter & { stderr?: EventEmitter | null }} */
      const child = new EventEmitter();
      child.stderr = options['stdio'] === 'inherit' ? null : new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
    spawnSync: (/** @type {string} */ command, /** @type {string[]} */ args, /** @type {Record<string, unknown>} */ options) => {
      calls.spawnSync.push({ command, args, options });
      return { status: 0, stdout: '{"admin":"none"}\n' };
    },
    createInterface: () => ({
      question: (/** @type {string} */ prompt) => {
        calls.questions.push(prompt);
        return Promise.resolve('odpowiedź');
      },
      close: () => calls.questions.push('closed'),
    }),
    resolve: (/** @type {string} */ directory, /** @type {string} */ request) => {
      calls.resolve.push([directory, request]);
      return join(directory, 'node_modules', request);
    },
  };
  const host = /** @type {Host} */ (/** @type {unknown} */ ({ ...base, ...overrides }));
  return { host, written, calls };
}

/**
 * A fake child process that ends with the given event.
 * @param {'close' | 'error'} event
 * @param {unknown} payload
 */
const endingSpawn = (event, payload) => () => {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit(event, payload));
  return child;
};

describe('EVM-077 AC2: wiring to the process', () => {
  it('EVM-077 AC2: reports the terminal and writes to the streams', () => {
    const { host, written } = fakeHost();
    const deps = processDeps(ROOT, host);
    assert.equal(deps.stdinIsTTY, true);
    assert.equal(deps.stdoutIsTTY, true);
    deps.out('a');
    deps.err('b');
    assert.deepEqual(written, { out: ['a'], err: ['b'] });
    const piped = processDeps(ROOT, fakeHost({ stdin: { isTTY: false }, stdout: { isTTY: false } }).host);
    assert.equal(piped.stdinIsTTY, false);
    assert.equal(piped.stdoutIsTTY, false);
  });

  it('EVM-077 AC3: asks on the terminal and closes it', async () => {
    const { host, calls } = fakeHost();
    assert.equal(await processDeps(ROOT, host).ask('Pytanie? '), 'odpowiedź');
    assert.deepEqual(calls.questions, ['Pytanie? ', 'closed']);
  });

  it('EVM-077 AC2: reads .env from the root, or null when there is none', () => {
    const { host } = fakeHost({
      readFile: (/** @type {string} */ path) => {
        assert.equal(path, join(ROOT, '.env'));
        throw new Error('ENOENT');
      },
    });
    assert.equal(processDeps(ROOT, host).readDotenv(), null);
    assert.match(processDeps(ROOT, fakeHost().host).readDotenv() ?? '', /OTHER=1/);
  });

  it('EVM-077 AC2: Docker gets CURSOR_KEY by the environment of the process only, from the repository root — one of the four lines', async () => {
    const { host, calls } = fakeHost();
    const result = await processDeps(ROOT, host).docker('down');
    assert.equal(result.status, 0);
    const [call] = calls.spawn;
    assert.ok(call);
    assert.equal(call.command, 'docker');
    assert.deepEqual(call.args, ['compose', '-f', 'compose.dev.yaml', 'down']);
    assert.equal(call.options['cwd'], ROOT);
    assert.equal(/** @type {Record<string, string>} */ (call.options['env'])['CURSOR_KEY'], 'zzkey');
    assert.ok(!JSON.stringify(call.args).includes('zzkey'));
    const noKey = fakeHost({ readFile: () => 'OTHER=1' });
    await processDeps(ROOT, noKey.host).docker('down');
    const [second] = noKey.calls.spawn;
    assert.ok(second);
    assert.equal('CURSOR_KEY' in /** @type {Record<string, string>} */ (second.options['env']), false);
  });

  it('EVM-077 AC2: builds the tools with the compiler of the API workspace, in that directory, with the given environment', () => {
    const { host, calls } = fakeHost();
    assert.equal(processDeps(ROOT, host).buildTools({ A: '1' }), 0);
    const [call] = calls.spawnSync;
    assert.ok(call);
    assert.equal(call.command, '/node');
    assert.deepEqual(call.args.slice(1), ['-p', 'tsconfig.dev.json']);
    assert.match(call.args[0] ?? '', /typescript[\\/]bin[\\/]tsc$/);
    assert.equal(call.options['cwd'], join(ROOT, 'apps', 'api'));
    assert.deepEqual(call.options['env'], { A: '1' });
    const crashed = fakeHost({ spawnSync: () => ({ status: null }) });
    assert.equal(processDeps(ROOT, crashed.host).buildTools({}), 1);
  });

  it('EVM-077 AC2: runs the compiled tool without a shell and keeps only its standard output', () => {
    const { host, calls } = fakeHost();
    const result = processDeps(ROOT, host).runTool('state', { A: '1' });
    assert.deepEqual(result, { status: 0, stdout: '{"admin":"none"}\n' });
    const [call] = calls.spawnSync;
    assert.ok(call);
    assert.deepEqual(call.args, [join(ROOT, 'apps', 'api', '.dev-build', 'dev', 'cli.js'), 'state']);
    assert.deepEqual(call.options['stdio'], ['ignore', 'pipe', 'inherit']);
    assert.notEqual(call.options['shell'], true);
    const silent = fakeHost({ spawnSync: () => ({ status: 3, stdout: null }) });
    assert.deepEqual(processDeps(ROOT, silent.host).runTool('seed', {}), { status: 3, stdout: '' });
  });

  it('EVM-077 AC2: starts the panel in the foreground with Node and the Vite binary, and returns its exit code', async () => {
    const { host, calls } = fakeHost();
    assert.equal(await processDeps(ROOT, host).runPanel({ B: '2' }), 0);
    const [call] = calls.spawn;
    assert.ok(call);
    assert.equal(call.command, '/node');
    assert.equal(call.args[0], join(ROOT, 'apps', 'web', 'node_modules', 'vite', 'bin', 'vite.js'));
    assert.equal(call.options['stdio'], 'inherit');
    assert.equal(call.options['cwd'], join(ROOT, 'apps', 'web'));
    assert.equal(await processDeps(ROOT, fakeHost({ spawn: endingSpawn('close', null) }).host).runPanel({}), 0);
    assert.equal(await processDeps(ROOT, fakeHost({ spawn: endingSpawn('error', new Error('x')) }).host).runPanel({}), 1);
  });

  it('EVM-077 AC2: the real host offers what the wiring needs', () => {
    const host = realHost();
    assert.equal(host.execPath, process.execPath);
    assert.equal(typeof host.readFile(fileURLToPath(import.meta.url)), 'string');
    assert.match(host.resolve(fileURLToPath(new URL('..', import.meta.url)), 'node:fs'), /fs/);
  });
});

describe('EVM-077 AC2: the command line entry', () => {
  it('EVM-077 AC2: without arguments it prints the usage and exits with 2; an unknown command too — nothing is started', () => {
    for (const args of [[], ['nonsense'], ['reset', '--yes']]) {
      const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: tmpdir() });
      assert.equal(result.status, 2, args.join(' '));
      assert.match(result.stderr, /Użycie: node tools\/dev-env\/cli\.mjs/);
    }
  });

  it('EVM-077 AC1: dev:init without .env.example in the directory fails with a named problem and no stack trace', () => {
    const directory = mkdtempSync(join(tmpdir(), 'evia-cli-'));
    try {
      const result = spawnSync(process.execPath, [CLI, 'init'], { encoding: 'utf8', cwd: directory });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /brak pliku \.env\.example/);
      assert.ok(!/\n\s+at /.test(result.stderr));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
