// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detect, isRelevantToMobile, MOBILE_RELEVANT_FILES, MOBILE_RELEVANT_PREFIXES } from '../lib/classify.mjs';

const BASE = 'a'.repeat(40);
/** @param {...string} files */
const pr = (...files) => detect({ eventName: 'pull_request', baseSha: BASE, diff: () => `${files.join('\0')}\0` });

describe('EVM-009 AC5: the output `mobile` (mobile-apk) is a positive list', () => {
  it('EVM-009 AC5: the files that can change the Android package are on the list', () => {
    for (const path of [
      'apps/mobile/src/App.tsx',
      'apps/mobile/package.json',
      'packages/tokens/src/build.ts',
      'packages/contracts/openapi/openapi.yaml',
      'design/tokens/color.json',
      'tools/mobile-apk/src/verify.mjs',
      '.nvmrc',
      '.npmrc',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'package.json',
      'turbo.json',
      'patches/busboy@1.6.0.patch',
      '.github/workflows/ci.yml',
    ]) {
      assert.equal(isRelevantToMobile(path), true, path);
      assert.equal(pr(path).mobile, true, path);
    }
    assert.ok(MOBILE_RELEVANT_PREFIXES.includes('apps/mobile/'));
    assert.ok(MOBILE_RELEVANT_FILES.includes('pnpm-lock.yaml'));
  });

  it('EVM-009 AC5: a change of the API, the panel, the documentation or another workflow does not build the package', () => {
    for (const path of [
      'apps/api/src/a.ts',
      'apps/web/src/a.tsx',
      'packages/ui-web/src/a.ts',
      'docs/backlog/M0/a.md',
      'README.md',
      '.github/workflows/nightly.yml',
      'tools/scan/cli.mjs',
      '.prettierrc.json',
      '.gitleaks.toml',
      'renovate.json',
      'compose.yaml',
    ]) {
      assert.equal(isRelevantToMobile(path), false, path);
      assert.equal(pr(path).mobile, false, path);
    }
  });

  it('EVM-009 AC5: one relevant file among others is enough, and the other outputs are independent of it', () => {
    const result = pr('docs/a.md', 'apps/api/src/a.ts', 'apps/mobile/src/a.ts');
    assert.deepEqual([result.heavy, result.e2e, result.integration, result.mobile], [true, false, true, true]);
    const apiOnly = pr('apps/api/src/a.ts');
    assert.deepEqual([apiOnly.heavy, apiOnly.e2e, apiOnly.integration, apiOnly.mobile], [true, false, true, false]);
  });

  it('EVM-009 AC5: a documentation-only change builds nothing (heavy=false implies mobile=false)', () => {
    const result = pr('docs/a.md', 'README.md');
    assert.deepEqual([result.heavy, result.mobile], [false, false]);
  });

  it('EVM-009 AC5: fail closed — a suspicious path, a diff error and every event but a pull request build the package', () => {
    for (const path of ['apps/api/../web/a.ts', 'apps\\api\\a.ts', 'apps/api/a\nb.ts', '/apps/api/a.ts', '']) {
      assert.equal(isRelevantToMobile(path), true, JSON.stringify(path));
    }
    assert.equal(pr('apps/api/../web/a.ts').mobile, true);
    const failing = detect({
      eventName: 'pull_request',
      baseSha: BASE,
      diff: () => {
        throw new Error('git failed');
      },
    });
    assert.equal(failing.mobile, true);
    for (const eventName of ['push', 'workflow_dispatch', 'schedule', '']) {
      assert.equal(detect({ eventName, baseSha: BASE, diff: () => 'docs/a.md\0' }).mobile, true, eventName);
    }
    assert.equal(detect({ eventName: 'pull_request', baseSha: '', diff: () => 'docs/a.md\0' }).mobile, true);
  });

  it('EVM-009 AC5: the reason names the Android job', () => {
    assert.match(pr('apps/mobile/a.ts').reason, /mobile-apk uruchomiony/);
    assert.match(pr('apps/api/a.ts').reason, /mobile-apk pominięty/);
  });
});
