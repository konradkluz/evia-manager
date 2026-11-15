// @ts-check
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ENGINE_DIRECTORY, GRADLE_TASKS, kotlinGate, LCOV_OUTPUT, realRun } from '../lib/kotlin-gate.mjs';
import { main } from '../lib/main.mjs';
import { capture } from './helpers/repo.mjs';

const REPORT = `<report><package name="pl/x"><sourcefile name="A.kt"><line nr="1" mi="0" ci="2" mb="0" cb="0"/></sourcefile></package></report>`;
const JAVA17 = { status: 0, stdout: '', stderr: 'openjdk version "17.0.13" 2024-10-15 LTS\nOpenJDK Runtime Environment' };

/** @type {string} */
let root;

/**
 * @param {Record<string, { status: number | null, stdout?: string, stderr?: string, error?: Error }>} [overrides] by key `<command-basename> <first arg>`
 */
function harness(overrides = {}) {
  /** @type {Array<{ command: string, args: string[], cwd: string }>} */
  const calls = [];
  const out = capture();
  const err = capture();
  const deps = {
    root,
    /** @type {NodeJS.ProcessEnv} */
    env: { JAVA_HOME: join(root, 'jdk') },
    platform: 'linux',
    stdout: out.stream,
    stderr: err.stream,
    /** @type {import('../lib/kotlin-gate.mjs').GateDeps['run']} */
    run(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      const isJava = command.endsWith('java') || command.endsWith('java.exe');
      const key = isJava ? 'java' : args.includes('--stop') ? 'stop' : 'gradle';
      const base = key === 'java' ? JAVA17 : { status: 0, stdout: `${key} ok\n`, stderr: '' };
      const result = { ...base, ...overrides[key] };
      if (key === 'gradle' && result.status === 0) {
        mkdirSync(join(root, ENGINE_DIRECTORY, 'build/reports/kover'), { recursive: true });
        if (!overrides['noreport'])
          writeFileSync(join(root, ENGINE_DIRECTORY, 'build/reports/kover/report.xml'), overrides['badreport'] ? 'x' : REPORT);
      }
      return result;
    },
  };
  return { deps, calls, out, err };
}

describe('Kotlin gate (EVM-109 AC5)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'evm109-kgate-'));
    mkdirSync(join(root, ENGINE_DIRECTORY), { recursive: true });
    writeFileSync(join(root, ENGINE_DIRECTORY, 'gradlew'), '#!/bin/sh\n');
    writeFileSync(join(root, ENGINE_DIRECTORY, 'gradlew.bat'), '@echo off\n');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('EVM-109 AC5: all steps in one Gradle run (ktlint, tests, Kover, dependencies), the lcov report for coverage:diff, the daemons stopped', () => {
    const { deps, calls, out } = harness();
    assert.equal(kotlinGate(deps), 0);
    const gradle = calls.find((call) => call.args.includes('ktlintCheck'));
    assert.ok(gradle);
    assert.deepEqual(gradle.args, [...GRADLE_TASKS]);
    assert.deepEqual(GRADLE_TASKS, ['--no-daemon', 'ktlintCheck', 'test', 'koverXmlReport', 'koverVerify', 'checkProductionDependencies']);
    assert.equal(gradle.cwd, join(root, ENGINE_DIRECTORY));
    assert.deepEqual(calls.at(-1)?.args, ['--stop']);
    assert.match(
      readFileSync(join(root, LCOV_OUTPUT), 'utf8'),
      /SF:apps\/mobile\/modules\/evia-upload\/engine\/src\/main\/kotlin\/pl\/x\/A\.kt/,
    );
    assert.match(out.text, /zielone/);
  });

  it('EVM-109 AC5: a red Gradle step is red (its exit code), still stops the daemons and leaves no report', () => {
    mkdirSync(join(root, 'coverage/mobile-kotlin'), { recursive: true });
    writeFileSync(join(root, LCOV_OUTPUT), 'stale');
    const { deps, calls, out } = harness({ gradle: { status: 1, stderr: 'ktlint violations' } });
    assert.equal(kotlinGate(deps), 1);
    assert.equal(existsSync(join(root, LCOV_OUTPUT)), false);
    assert.deepEqual(calls.at(-1)?.args, ['--stop']);
    assert.match(out.text, /CZERWONE \(kod 1\)/);
  });

  it('EVM-109 AC5: without JDK 17 the gate fails with a clear message, never a silent skip', () => {
    for (const stderr of ['openjdk version "21.0.2" 2024-01-16', 'java version "1.8.0_391"', 'garbage']) {
      const { deps, calls, err } = harness({ java: { status: 0, stderr } });
      assert.equal(kotlinGate(deps), 2, stderr);
      assert.match(err.text, /wymagany JDK 17/);
      assert.equal(
        calls.some((call) => call.args.includes('ktlintCheck')),
        false,
      );
    }
    const missing = harness({ java: { status: null, stderr: '', error: new Error('ENOENT') } });
    assert.equal(kotlinGate(missing.deps), 2);
    assert.match(missing.err.text, /brak lub nieczytelna wersja/);
  });

  it('EVM-109 AC5: JAVA_HOME unset uses java from the PATH', () => {
    const { deps, calls } = harness();
    deps.env = {};
    assert.equal(kotlinGate(deps), 0);
    assert.equal(calls[0]?.command, 'java');
  });

  it('EVM-109 AC5: a missing wrapper is exit 2', () => {
    rmSync(join(root, ENGINE_DIRECTORY, 'gradlew'));
    const { deps, err } = harness();
    assert.equal(kotlinGate(deps), 2);
    assert.match(err.text, /brak wrappera Gradle/);
  });

  it('EVM-109 AC5: on Windows the batch wrapper runs through cmd.exe with constant arguments only', () => {
    const { deps, calls } = harness();
    deps.platform = 'win32';
    assert.equal(kotlinGate(deps), 0);
    const gradle = calls.find((call) => call.args.includes('ktlintCheck'));
    assert.ok(gradle);
    assert.equal(gradle.command, 'cmd.exe');
    assert.deepEqual(gradle.args.slice(0, 3), ['/d', '/c', 'call']);
    assert.equal(gradle.args[3], join(root, ENGINE_DIRECTORY, 'gradlew.bat'));
    assert.equal(calls[0]?.command, join(root, 'jdk', 'bin', 'java.exe'));
  });

  it('EVM-109 AC5: success without a Kover report, or with a malformed one, is exit 2 (never a green pass without coverage)', () => {
    const missing = harness({ noreport: { status: 0 } });
    assert.equal(kotlinGate(missing.deps), 2);
    assert.match(missing.err.text, /nie ma raportu Kover/);
    const bad = harness({ badreport: { status: 0 } });
    assert.equal(kotlinGate(bad.deps), 2);
    assert.match(bad.err.text, /nie przekonwertowano raportu Kover/);
  });

  it('EVM-109 AC5: Gradle that cannot start is exit 2; a failing --stop only warns', () => {
    const broken = harness({ gradle: { status: null, error: new Error('spawn EACCES') } });
    assert.equal(kotlinGate(broken.deps), 2);
    assert.match(broken.err.text, /nie uruchomiono Gradle/);
    const stop = harness({ stop: { status: 1 } });
    assert.equal(kotlinGate(stop.deps), 0);
    assert.match(stop.err.text, /nie zatrzymano demonów/);
  });

  it('EVM-109 AC5: the real runner reports a missing program as an error, not as a thrown exception', () => {
    const result = realRun(join(root, 'does-not-exist'), [], { cwd: root, env: {} });
    assert.ok(result.error);
    assert.equal(realRun(process.execPath, ['-e', 'process.stdout.write("x")'], { cwd: root, env: {} }).stdout, 'x');
  });
});

describe('kotlin-gate command of diff-coverage (EVM-109 AC5)', () => {
  it('EVM-109 AC5: the command is wired to the gate and fails with exit 2 where there is no repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evm109-kgate-cmd-'));
    try {
      const out = capture();
      const err = capture();
      assert.equal(main(['kotlin-gate'], { cwd: dir, stdout: out.stream, stderr: err.stream }), 2);
      assert.match(err.text, /diff-coverage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
