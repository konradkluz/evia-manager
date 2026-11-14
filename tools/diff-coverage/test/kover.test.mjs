// @ts-check
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { koverToLcov, KoverReportError } from '../lib/kover.mjs';
import { parseLcov } from '../lib/lcov.mjs';
import { main } from '../lib/main.mjs';
import { capture, tempRepo } from './helpers/repo.mjs';

const REPORT = `<?xml version="1.0" ?>
<report name="Kover Gradle Plugin XML report for :">
<package name="pl/eviacharge/upload">
<class name="pl/eviacharge/upload/Planner" sourcefilename="Planner.kt">
<method name="plan" desc="()V">
<counter type="LINE" missed="0" covered="3"/>
</method>
</class>
<sourcefile name="Planner.kt">
<line nr="3" mi="0" ci="5" mb="0" cb="0"/>
<line nr="7" mi="2" ci="9" mb="1" cb="3"/>
<line nr="9" mi="4" ci="0" mb="2" cb="0"/>
<counter type="LINE" missed="1" covered="2"/>
</sourcefile>
<sourcefile name="A&amp;B.kt">
<line nr="1" mi="0" ci="1" mb="0" cb="0"/>
</sourcefile>
</package>
<package name="pl/eviacharge/other">
<sourcefile name="Other.kt">
<line nr="2" mi="1" ci="1" mb="0" cb="0"/>
</sourcefile>
</package>
<counter type="LINE" missed="1" covered="2"/>
</report>
`;

const ROOT = 'apps/mobile/modules/evia-upload/engine/src/main/kotlin';

describe('Kover XML to lcov converter (EVM-109 AC5)', () => {
  it('EVM-109 AC5: source files get repository-relative SF paths, DA from instruction counts and BRDA from branch counts', () => {
    const records = parseLcov(koverToLcov(REPORT, ROOT));
    assert.deepEqual(
      records.map((record) => record.source),
      [`${ROOT}/pl/eviacharge/other/Other.kt`, `${ROOT}/pl/eviacharge/upload/A&B.kt`, `${ROOT}/pl/eviacharge/upload/Planner.kt`],
    );
    const planner = records[2];
    assert.deepEqual(
      [...(planner?.lines ?? [])],
      [
        [3, 5],
        [7, 9],
        [9, 0],
      ],
    );
    // line 7: 3 covered and 1 missed branch; line 9: 2 missed branches
    assert.deepEqual(
      [...(planner?.branches ?? [])],
      [
        ['7:0:0', 1],
        ['7:0:1', 1],
        ['7:0:2', 1],
        ['7:0:3', 0],
        ['9:0:0', 0],
        ['9:0:1', 0],
      ],
    );
  });

  it('EVM-109 AC5: the output carries line and branch totals per file (LF, LH, BRF, BRH)', () => {
    const text = koverToLcov(REPORT, ROOT);
    assert.match(text, /LF:3\nLH:2\nBRF:6\nBRH:3\nend_of_record/);
  });

  it('EVM-109 AC5: a trailing slash in the source root is tolerated and a package at the root has no extra segment', () => {
    const text = koverToLcov(
      '<report><package name=""><sourcefile name="Root.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      `${ROOT}/`,
    );
    assert.match(text, new RegExp(`SF:${ROOT}/Root\\.kt\\n`));
  });

  it('EVM-109 AC5: malformed or suspicious input is an error, never an empty green report', () => {
    for (const bad of [
      '',
      'not xml',
      '<report></report>',
      '<?xml version="1.0"?><!DOCTYPE report [<!ENTITY x SYSTEM "file:///etc/passwd">]><report><package name="a"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><line mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><line nr="x" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="../A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="../a"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></report>',
      '<report><package><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name=""><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"></sourcefile></package></report>',
      '<report><package name="a"><package name="b"></package></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><sourcefile name="B.kt"></sourcefile></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"/></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"></line></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile>',
      '<report><package name="a/./b"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="/a"><sourcefile name="A.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A&unknown;.kt"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
      '<report><package name="a"><sourcefile name="A.kt"><line nr="1" mi="x" ci="1" mb="0" cb="0"/></sourcefile></package></report>',
    ]) {
      assert.throws(() => koverToLcov(bad, ROOT), KoverReportError, bad.slice(0, 60));
    }
  });
});

describe('diff-coverage on Kotlin sources (EVM-109 AC5)', () => {
  const SOURCE = 'apps/mobile/modules/evia-upload/engine/src/main/kotlin/pl/eviacharge/upload/Planner.kt';
  /** @type {ReturnType<typeof tempRepo>} */
  let repo;

  /** @param {string[]} [args] */
  function run(args = []) {
    const out = capture();
    const err = capture();
    const status = main(args, { cwd: repo.root, stdout: out.stream, stderr: err.stream });
    return { status, out: out.text, err: err.text };
  }

  /** @param {(line: number) => number} hits */
  const report = (hits) =>
    ['TN:', `SF:${SOURCE}`, ...Array.from({ length: 10 }, (_, i) => `DA:${i + 1},${hits(i + 1)}`), 'end_of_record', ''].join('\n');

  beforeEach(() => {
    repo = tempRepo('evm109-kotlin-');
    repo.write(
      'packages/config/coverage-exclusions.json',
      JSON.stringify({
        exclude: [
          { pattern: '**/test/**', reason: 'tests' },
          { pattern: 'apps/mobile/modules/evia-upload/android/**', reason: 'Android glue' },
        ],
      }),
    );
    repo.write('README.md', '# synthetic\n');
    repo.commit('chore: base');
    repo.git(['checkout', '--quiet', '-b', 'feature/EVM-999-x']);
    repo.write(SOURCE, Array.from({ length: 10 }, (_, i) => `val v${i} = ${i}`).join('\n') + '\n');
  });
  afterEach(() => {
    repo.dispose();
  });

  it('EVM-109 AC5: a changed .kt file without a report is red, not a silent pass', () => {
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /brak raportu/);
  });

  it('EVM-109 AC5: the Kotlin report in coverage/mobile-kotlin counts (SF relative to the repository root)', () => {
    repo.write(
      'coverage/mobile-kotlin/lcov.info',
      report(() => 1),
    );
    assert.equal(run().status, 0);
    repo.write(
      'coverage/mobile-kotlin/lcov.info',
      report((line) => (line <= 5 ? 1 : 0)),
    );
    const { status, out } = run();
    assert.equal(status, 1, out);
    assert.match(out, /6, 7, 8, 9, 10/);
  });

  it('EVM-109 AC5: Kotlin tests, build scripts and the Android glue are not measured', () => {
    repo.write('apps/mobile/modules/evia-upload/engine/src/test/kotlin/pl/eviacharge/upload/PlannerTest.kt', 'class T\n');
    repo.write('apps/mobile/modules/evia-upload/engine/build.gradle.kts', 'plugins {}\n');
    repo.write('apps/mobile/modules/evia-upload/android/src/main/kotlin/Glue.kt', 'class Glue\n');
    repo.write(
      'coverage/mobile-kotlin/lcov.info',
      report(() => 1),
    );
    const { status, out } = run();
    assert.equal(status, 0, out);
    assert.doesNotMatch(out, /PlannerTest|Glue|build\.gradle/);
  });

  it('EVM-109 AC5: clean removes the Kotlin report with the others', () => {
    repo.write('coverage/mobile-kotlin/lcov.info', 'TN:\n');
    const { status, out } = run(['clean']);
    assert.equal(status, 0);
    assert.match(out, /usunięto 1/);
    assert.equal(existsSync(join(repo.root, 'coverage/mobile-kotlin/lcov.info')), false);
  });

  describe('kover-to-lcov command', () => {
    it('EVM-109 AC5: converts the XML into the report under coverage/mobile-kotlin', () => {
      repo.write('engine/report.xml', REPORT);
      const { status } = run(['kover-to-lcov', 'engine/report.xml', ROOT, 'coverage/mobile-kotlin/lcov.info']);
      assert.equal(status, 0);
      const text = readFileSync(join(repo.root, 'coverage/mobile-kotlin/lcov.info'), 'utf8');
      assert.match(text, new RegExp(`SF:${ROOT}/pl/eviacharge/upload/Planner\\.kt`));
    });

    it('EVM-109 AC5: a missing, malformed or misused input is exit 2 and writes nothing', () => {
      repo.write('engine/bad.xml', '<report></report>');
      for (const args of [
        ['kover-to-lcov', 'engine/missing.xml', ROOT, 'coverage/mobile-kotlin/lcov.info'],
        ['kover-to-lcov', 'engine/bad.xml', ROOT, 'coverage/mobile-kotlin/lcov.info'],
        ['kover-to-lcov', 'engine/bad.xml'],
        ['kover-to-lcov', 'engine/bad.xml', ROOT, '../outside.info'],
        ['kover-to-lcov', join(repo.root, 'engine/bad.xml'), ROOT, 'coverage/mobile-kotlin/lcov.info'],
        ['kover-to-lcov', 'engine/bad.xml', '../evil', 'coverage/mobile-kotlin/lcov.info'],
        ['kover-to-lcov', 'engine/bad.xml', '/abs', 'coverage/mobile-kotlin/lcov.info'],
      ]) {
        const { status, err } = run(args);
        assert.equal(status, 2, args.join(' '));
        assert.notEqual(err, '');
      }
      assert.equal(existsSync(join(repo.root, 'coverage/mobile-kotlin/lcov.info')), false);
    });
  });
});
