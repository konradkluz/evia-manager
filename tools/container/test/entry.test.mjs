// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../sync.mjs', import.meta.url));

describe('backend-tests image entry point (EVM-006 AC2)', () => {
  it('EVM-006 AC2: without a command the entry point prints usage and exits with 2 (nothing is synchronised)', () => {
    const result = spawnSync(process.execPath, [ENTRY], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Użycie: sync\.mjs install/);
  });
});
