import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initEnvFile } from '../src/env-file.mjs';

const EXAMPLE = '# example\nNODE_ENV=development\nCURSOR_KEY=\nOTHER=1\n';

/** @param {(directory: string) => void} run */
function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), 'evia-dev-env-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('EVM-077 AC1: dev:init', () => {
  it('EVM-077 AC1: creates .env from .env.example with a random 43-character base64url CURSOR_KEY', () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, '.env.example'), EXAMPLE);
      assert.deepEqual(initEnvFile(directory), { status: 'created' });
      const content = readFileSync(join(directory, '.env'), 'utf8');
      const key = /^CURSOR_KEY=(.*)$/m.exec(content)?.[1] ?? '';
      assert.match(key, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(key, 'base64url').length, 32);
      assert.equal(content.replace(key, ''), EXAMPLE);
    });
  });

  it('EVM-077 AC1: never overwrites an existing .env', () => {
    withDirectory((directory) => {
      writeFileSync(join(directory, '.env.example'), EXAMPLE);
      writeFileSync(join(directory, '.env'), 'MINE=1\n');
      assert.deepEqual(initEnvFile(directory), { status: 'exists' });
      assert.equal(readFileSync(join(directory, '.env'), 'utf8'), 'MINE=1\n');
    });
  });

  it('EVM-077 AC1: writes atomically with the flag wx and owner-only mode (no check-then-write)', () => {
    /** @type {Array<{ path: string, data: string, options: { flag: string, mode: number } }>} */
    const calls = [];
    const result = initEnvFile('/repo', {
      readFile: () => EXAMPLE,
      writeFile: (path, data, options) => {
        calls.push({ path, data, options });
      },
      random: () => Buffer.alloc(32, 7),
    });
    assert.deepEqual(result, { status: 'created' });
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.ok(call);
    assert.deepEqual(call.options, { flag: 'wx', mode: 0o600 });
    assert.ok(call.data.includes(`CURSOR_KEY=${Buffer.alloc(32, 7).toString('base64url')}`));
  });

  it('EVM-077 AC1: reports a missing example and a write error without leaking anything', () => {
    assert.deepEqual(
      initEnvFile('/repo', {
        readFile: () => {
          throw new Error('secret path detail');
        },
      }),
      { status: 'no-example' },
    );
    const failing = initEnvFile('/repo', {
      readFile: () => EXAMPLE,
      writeFile: () => {
        throw Object.assign(new Error('boom'), { code: 'EACCES' });
      },
    });
    assert.deepEqual(failing, { status: 'failed' });
  });
});
