import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { classifyUpFailure, COMMANDS, dockerRunner } from '../src/docker.mjs';

/**
 * @typedef {{ command: string, args: string[], options: { stdio: unknown } }} SpawnCall
 * @param {{ emit: (child: EventEmitter) => void, stderr?: string }} script what the fake child does
 */
function fakeSpawn({ emit, stderr = '' }) {
  /** @type {SpawnCall[]} */
  const calls = [];
  /** @param {string} command @param {string[]} args @param {{ stdio: unknown }} options */
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    /** @type {EventEmitter & { stderr?: EventEmitter | null }} */
    const child = new EventEmitter();
    child.stderr = options.stdio === 'inherit' ? null : new EventEmitter();
    queueMicrotask(() => {
      if (child.stderr && stderr !== '') child.stderr.emit('data', Buffer.from(stderr));
      emit(child);
    });
    return child;
  };
  return { calls, spawnProcess: /** @type {typeof import('node:child_process').spawn} */ (/** @type {unknown} */ (run)) };
}

describe('EVM-077 AC8: the exact forms of Docker commands for compose.dev.yaml', () => {
  it('EVM-077 AC8: exactly four command lines, frozen', () => {
    assert.deepEqual(
      { ...COMMANDS },
      {
        up: ['compose', '-f', 'compose.dev.yaml', 'up', '-d', '--wait', '--build'],
        down: ['compose', '-f', 'compose.dev.yaml', 'down'],
        downVolumes: ['compose', '-f', 'compose.dev.yaml', 'down', '-v'],
        adminExec: ['compose', '-f', 'compose.dev.yaml', 'exec', 'api', 'node', 'dist/src/cli/bootstrap-admin.js'],
      },
    );
    assert.ok(Object.isFrozen(COMMANDS));
    for (const args of Object.values(COMMANDS)) assert.ok(Object.isFrozen(args));
  });

  it('EVM-077 AC5: the Administrator procedure inherits the terminal — no pipe, no capture, no -T, no user override', async () => {
    const { calls, spawnProcess } = fakeSpawn({ emit: (child) => child.emit('close', 0) });
    const stderr = {
      write: () => {
        assert.fail('nothing is captured from the terminal command');
      },
    };
    const result = await dockerRunner({ cwd: '/repo', env: { A: '1' }, spawnProcess, stderr })('adminExec');
    assert.deepEqual(result, { status: 0, stderr: '', error: undefined });
    const [call] = calls;
    assert.ok(call);
    assert.equal(call.command, 'docker');
    assert.equal(call.options.stdio, 'inherit');
    assert.ok(!call.args.some((arg) => ['-T', '-u', '-e', '--user', '--env', '--emergency'].includes(arg)));
  });

  it('EVM-077 AC2: up shows the Docker output live and keeps it to explain a failure', async () => {
    /** @type {string[]} */
    const shown = [];
    const { spawnProcess, calls } = fakeSpawn({ stderr: 'port is already allocated', emit: (child) => child.emit('close', 1) });
    const result = await dockerRunner({
      cwd: '/repo',
      env: {},
      spawnProcess,
      stderr: {
        write: (chunk) => {
          shown.push(String(chunk));
        },
      },
    })('up');
    assert.equal(result.status, 1);
    assert.equal(classifyUpFailure(result), 'port');
    assert.deepEqual(shown, ['port is already allocated']);
    const [call] = calls;
    assert.ok(call);
    assert.deepEqual(call.options.stdio, ['ignore', 'inherit', 'pipe']);
  });

  it('EVM-077 AC2: reports a spawn error (no Docker installed)', async () => {
    const { spawnProcess } = fakeSpawn({ emit: (child) => child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' })) });
    const result = await dockerRunner({ cwd: '/repo', env: {}, spawnProcess })('down');
    assert.equal(result.status, null);
    assert.equal(classifyUpFailure(result), 'no-docker');
  });

  it('EVM-077 AC2: classifies the failures of up', () => {
    /** @param {string} stderr @param {Error} [error] */
    const result = (stderr, error) => ({ status: 1, stderr, error });
    assert.equal(classifyUpFailure(result('', Object.assign(new Error('x'), { code: 'EPERM' }))), 'other');
    assert.equal(classifyUpFailure(result('error during connect: open //./pipe/docker_engine')), 'daemon');
    assert.equal(classifyUpFailure(result('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')), 'daemon');
    assert.equal(classifyUpFailure(result('Bind for 127.0.0.1:3000 failed: port is already allocated')), 'port');
    assert.equal(classifyUpFailure(result('something else')), 'other');
  });
});
