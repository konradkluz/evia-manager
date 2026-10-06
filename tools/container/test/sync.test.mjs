// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { assertInside, exportCoverage, main, syncTree } from '../lib/sync.mjs';

/** @type {string} */
let base;
/** @param {string} root @param {string} path @param {string} [text] */
const put = (root, path, text = path) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
/** @param {string} root @param {string} path */
const read = (root, path) => readFileSync(join(root, path), 'utf8');

/** @param {string} [mode] */
const linkType = (mode = 'junction') => /** @type {'junction' | 'file'} */ (mode);

describe('backend-tests source sync (EVM-006 AC1, AC2; W10)', () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'evm006-sync-'));
    mkdirSync(join(base, 'src'));
    mkdirSync(join(base, 'repo'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('EVM-006 AC2: copies the mounted sources into the writable working copy and skips generated directories', () => {
    put(join(base, 'src'), 'package.json', '{}');
    put(join(base, 'src'), 'packages/a/src/index.ts', 'export {};');
    for (const skipped of [
      'node_modules/x/index.js',
      'packages/a/node_modules/y.js',
      'packages/a/dist/a.js',
      'packages/a/coverage/lcov.info',
      '.turbo/cache',
    ]) {
      put(join(base, 'src'), skipped);
    }
    const stats = syncTree(join(base, 'src'), join(base, 'repo'));
    assert.equal(read(join(base, 'repo'), 'packages/a/src/index.ts'), 'export {};');
    for (const skipped of ['node_modules', 'packages/a/node_modules', 'packages/a/dist', 'packages/a/coverage', '.turbo']) {
      assert.equal(existsSync(join(base, 'repo', skipped)), false, skipped);
    }
    assert.deepEqual(stats, { copied: 2, removed: 0, unchanged: 0 });
  });

  it('EVM-006 AC2: a second sync copies only changed files and removes files deleted at the source', () => {
    put(join(base, 'src'), 'a.txt', 'one');
    put(join(base, 'src'), 'dir/b.txt', 'two');
    put(join(base, 'src'), 'old/c.txt', 'three');
    syncTree(join(base, 'src'), join(base, 'repo'));
    put(join(base, 'src'), 'a.txt', 'one, changed');
    rmSync(join(base, 'src', 'old'), { recursive: true });
    const stats = syncTree(join(base, 'src'), join(base, 'repo'));
    assert.deepEqual(stats, { copied: 1, removed: 1, unchanged: 1 });
    assert.equal(read(join(base, 'repo'), 'a.txt'), 'one, changed');
    assert.equal(existsSync(join(base, 'repo', 'old')), false);
  });

  it('EVM-006 W10: never deletes node_modules, build output or coverage of the working copy', () => {
    put(join(base, 'src'), 'packages/a/package.json', '{}');
    put(join(base, 'repo'), 'node_modules/.pnpm/lock.yaml', 'store links');
    put(join(base, 'repo'), 'packages/a/node_modules/dep/index.js', 'dep');
    put(join(base, 'repo'), 'packages/a/dist/x.js', 'x');
    syncTree(join(base, 'src'), join(base, 'repo'));
    assert.equal(existsSync(join(base, 'repo', 'node_modules/.pnpm/lock.yaml')), true);
    assert.equal(existsSync(join(base, 'repo', 'packages/a/node_modules/dep/index.js')), true);
    assert.equal(existsSync(join(base, 'repo', 'packages/a/dist/x.js')), true);
  });

  it('EVM-006 W10: a file replaced by a directory (and back) is handled inside the working copy', () => {
    put(join(base, 'src'), 'x', 'file');
    syncTree(join(base, 'src'), join(base, 'repo'));
    rmSync(join(base, 'src', 'x'));
    put(join(base, 'src'), 'x/inner.txt', 'now a directory');
    syncTree(join(base, 'src'), join(base, 'repo'));
    assert.equal(read(join(base, 'repo'), 'x/inner.txt'), 'now a directory');
    rmSync(join(base, 'src', 'x'), { recursive: true });
    put(join(base, 'src'), 'x', 'file again');
    syncTree(join(base, 'src'), join(base, 'repo'));
    assert.equal(read(join(base, 'repo'), 'x'), 'file again');
  });

  it('EVM-006 W10: symbolic links are neither copied nor followed, and a link in the working copy is removed, not its target', (t) => {
    const outside = join(base, 'outside');
    put(outside, 'keep.txt', 'must survive');
    put(join(base, 'src'), 'real.txt', 'r');
    try {
      symlinkSync(outside, join(base, 'src', 'link-dir'), linkType());
      symlinkSync(outside, join(base, 'repo', 'stale-link'), linkType());
    } catch {
      t.skip('symbolic links are not available on this system');
      return;
    }
    syncTree(join(base, 'src'), join(base, 'repo'));
    assert.equal(existsSync(join(base, 'repo', 'link-dir')), false);
    assert.equal(existsSync(join(base, 'repo', 'stale-link')), false);
    assert.equal(read(outside, 'keep.txt'), 'must survive');
  });

  it('EVM-006 W10: a target outside the working copy root is refused', () => {
    assert.throws(() => assertInside(join(base, 'repo'), join(base, 'repo', '..', 'src', 'a')), /outside/);
    assert.throws(() => assertInside(join(base, 'repo'), join(base, 'repo')), /outside/);
    assert.equal(assertInside(join(base, 'repo'), join(base, 'repo', 'a', 'b')), join(base, 'repo', 'a', 'b'));
  });

  it('EVM-006 AC3: exports workspace lcov reports to the output directory and clears stale output first (W3b)', () => {
    const out = join(base, 'out');
    put(out, 'packages/gone/coverage/lcov.info', 'stale');
    put(join(base, 'repo'), 'packages/a/coverage/lcov.info', 'SF:a');
    put(join(base, 'repo'), 'tools/t/coverage/lcov.info', 'SF:t');
    put(join(base, 'repo'), 'packages/a/coverage/index.html', 'not exported');
    put(join(base, 'repo'), 'node_modules/x/coverage/lcov.info', 'never');
    put(join(base, 'repo'), 'packages/a/coverage/integration/lcov.info', 'SF:integration');
    const exported = exportCoverage(join(base, 'repo'), out);
    // the integration report (SF paths relative to the repository root) goes where CI puts its artifact (EVM-016)
    assert.deepEqual(exported, ['integration-a/lcov.info', 'packages/a/coverage/lcov.info', 'tools/t/coverage/lcov.info']);
    assert.equal(read(out, 'integration-a/lcov.info'), 'SF:integration');
    assert.equal(read(out, 'packages/a/coverage/lcov.info'), 'SF:a');
    assert.equal(existsSync(join(out, 'packages/gone')), false);
    assert.equal(existsSync(join(out, 'packages/a/coverage/index.html')), false);
  });
});

describe('backend-tests entry point (EVM-006 AC1, AC2)', () => {
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'evm006-sync-main-'));
    put(join(base, 'src'), 'package.json', '{}');
    put(join(base, 'src'), 'packages/a/package.json', '{}');
    mkdirSync(join(base, 'repo'));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  /** @param {number[]} statuses */
  const fakeSpawn = (statuses) => {
    /** @type {string[]} */
    const calls = [];
    return {
      calls,
      /** @param {string} command @param {string[]} args @param {string} cwd */
      spawn: (command, args, cwd) => {
        calls.push(`${command} ${args.join(' ')} @ ${cwd}`);
        return statuses.shift() ?? 0;
      },
    };
  };

  /** @param {string[]} argv @param {ReturnType<typeof fakeSpawn>} fake */
  const run = (argv, fake) => {
    /** @type {string[]} */
    const log = [];
    const paths = {
      src: join(base, 'src'),
      repo: join(base, 'repo'),
      store: join(base, 'store'),

      out: join(base, 'out'),
    };
    const status = main(argv, { ...paths, spawn: fake.spawn, log: (line) => log.push(line) });
    return { status, log };
  };

  it('EVM-006 AC1: install — sync, then pnpm install from the lockfile with the shared store (network allowed)', () => {
    const fake = fakeSpawn([0]);
    const { status } = run(['install'], fake);
    assert.equal(status, 0);
    assert.deepEqual(fake.calls, [`pnpm install --frozen-lockfile --store-dir ${join(base, 'store')} @ ${join(base, 'repo')}`]);
    assert.equal(read(join(base, 'repo'), 'package.json'), '{}');
  });

  it('EVM-006 AC2: a command runs after an offline install; coverage is exported and the exit code of the command is returned', () => {
    put(join(base, 'repo'), 'packages/a/coverage/lcov.info', 'SF:a');
    const fake = fakeSpawn([0, 3]);
    const { status } = run(['pnpm', 'run', 'gate:backend'], fake);
    assert.equal(status, 3);
    assert.deepEqual(fake.calls, [
      `pnpm install --offline --frozen-lockfile --store-dir ${join(base, 'store')} @ ${join(base, 'repo')}`,
      `pnpm run gate:backend @ ${join(base, 'repo')}`,
    ]);
    assert.equal(read(join(base, 'out'), 'packages/a/coverage/lcov.info'), 'SF:a');
  });

  it('EVM-006 AC1: a failed offline install stops with a hint to run backend-install', () => {
    const fake = fakeSpawn([1]);
    const { status, log } = run(['pnpm', 'run', 'gate:backend'], fake);
    assert.equal(status, 1);
    assert.equal(fake.calls.length, 1);
    assert.match(log.join('\n'), /docker compose -f compose\.yaml run --rm backend-install/);
  });

  it('EVM-006 AC2: no command → usage error 2', () => {
    const { status, log } = run([], fakeSpawn([]));
    assert.equal(status, 2);
    assert.match(log.join('\n'), /Użycie/);
  });
});
