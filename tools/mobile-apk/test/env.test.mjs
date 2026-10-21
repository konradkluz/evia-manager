import assert from 'node:assert/strict';
import { delimiter, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { childEnv, PASSED_ENV, resolveProgram } from '../src/env.mjs';

describe('environment of child processes (EVM-009 AC5; security-engineer)', () => {
  it('EVM-009 AC5: only the allow-list passes (case-insensitive names), the password variables and other secrets never do', () => {
    const env = childEnv({
      Path: '/bin',
      JAVA_HOME: '/jdk',
      SystemRoot: 'C:/Windows',
      ANDROID_HOME: '/sdk',
      EVIA_APK_KS_PASS: 'synthetic-a',
      EVIA_APK_KEY_PASS: 'synthetic-b',
      GITHUB_TOKEN: 'synthetic-c',
      JAVA_TOOL_OPTIONS: '-javaagent:evil.jar',
      EMPTY: undefined,
    });
    assert.deepEqual(env, {
      Path: '/bin',
      JAVA_HOME: '/jdk',
      SystemRoot: 'C:/Windows',
      ANDROID_HOME: '/sdk',
      NoDefaultCurrentDirectoryInExePath: '1',
    });
    assert.ok(PASSED_ENV.every((name) => name === name.toUpperCase()));
  });

  it('EVM-009 AC5: a program is resolved from absolute directories of PATH only — never from the current directory', () => {
    const bin = resolve('/tools/bin');
    const other = resolve('/other');
    const present = new Set([join(other, 'git'), join(bin, 'git'), join(other, 'git.exe'), join(bin, 'git.exe'), 'git', 'git.exe']);
    const exists = (/** @type {string} */ path) => present.has(path);
    const path = ['', '.', 'relative', bin, other].join(delimiter);
    for (const platform of ['linux', 'win32']) {
      const found = resolveProgram('git', { env: { PATH: path }, platform, exists });
      assert.equal(found, join(bin, platform === 'win32' ? 'git.exe' : 'git'));
    }
    assert.equal(resolveProgram('git', { env: { PATH: ['', '.'].join(delimiter) }, platform: 'linux', exists }), null);
    assert.equal(resolveProgram('git', { env: {}, platform: 'linux', exists }), null);
    assert.equal(resolveProgram('git', { env: { Path: bin }, platform: 'linux', exists }), join(bin, 'git'));
  });
});
