// @ts-check
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

describe('diff-coverage entry point (EVM-006 AC3)', () => {
  it('EVM-006 AC3: the CLI passes arguments to main and exits with its code', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Użycie: node tools\/diff-coverage\/cli\.mjs \[clean\]/);
  });
});
