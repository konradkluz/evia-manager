// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  actionlintVerdict,
  ALLOWED_LICENSES,
  gitleaksVerdict,
  licenseAllowed,
  osvVerdict,
  semgrepVerdict,
  trivyConfigVerdict,
  trivyLicenseVerdict,
  zizmorVerdict,
} from '../lib/reports.mjs';

describe('gitleaks verdict (EVM-006 AC5, bramka 1)', () => {
  it('EVM-006 AC5: no findings in a scanned history → green; findings name rule, file, line and commit — never the secret', () => {
    assert.deepEqual(gitleaksVerdict([], { log: 'INF 125 commits scanned.', requireCommits: true }), {
      passed: true,
      summary: '125 commitów, wykrycia: 0',
      problems: [],
    });
    const red = gitleaksVerdict([{ RuleID: 'github-pat', File: 'a.txt', StartLine: 3, Commit: 'f'.repeat(40), Secret: 'REDACTED' }], {
      log: '1 commits scanned',
      requireCommits: true,
    });
    assert.equal(red.passed, false);
    assert.deepEqual(red.problems, ['github-pat · a.txt:3 · commit ffffffffffff']);
  });

  it('EVM-006 AC5: an empty history or a missing report fails (the gate cannot be silently disabled)', () => {
    assert.equal(gitleaksVerdict([], { log: '', requireCommits: true }).passed, false);
    assert.equal(gitleaksVerdict(null).passed, false);
    assert.equal(gitleaksVerdict([{ RuleID: 'x', File: 'f', StartLine: 1 }]).problems[0], 'x · f:1');
  });
});

describe('Semgrep verdict (EVM-006 AC4, bramka 2)', () => {
  /**
   * @param {unknown[]} results
   * @param {{ scanned?: string[], errors?: unknown[] }} [options]
   */
  const report = (results, { scanned = ['packages/a.ts'], errors = [] } = {}) => ({ results, errors, paths: { scanned } });

  it('EVM-006 AC4: ERROR findings and our own rules block; WARNING is a report', () => {
    const verdict = semgrepVerdict(
      report([
        { check_id: 'javascript.lang.security.x', path: 'a.ts', start: { line: 1 }, extra: { severity: 'ERROR' } },
        { check_id: 'src.semgrep.rules.evm-no-dynamic-code', path: 'b.ts', start: { line: 2 }, extra: { severity: 'WARNING' } },
        { check_id: 'javascript.style.y', path: 'c.ts', start: { line: 3 }, extra: { severity: 'WARNING' } },
      ]),
    );
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.problems, ['javascript.lang.security.x · a.ts:1', 'src.semgrep.rules.evm-no-dynamic-code · b.ts:2']);
    assert.equal(semgrepVerdict(report([{ check_id: 'javascript.style.y', extra: { severity: 'WARNING' } }])).passed, true);
  });

  it('EVM-006 AC4: tool errors, an empty target and a malformed report fail', () => {
    assert.equal(semgrepVerdict(report([], { errors: [{ level: 'error', type: 'Timeout', message: 'x\ny' }] })).passed, false);
    assert.equal(semgrepVerdict(report([], { errors: [{ level: 'warn', type: 'Syntax', message: 'w' }] })).passed, true);
    assert.equal(semgrepVerdict(report([], { scanned: [] })).summary, 'pusty cel skanu (0 plików)');
    assert.equal(semgrepVerdict({}).passed, false);
  });
});

describe('OSV verdict (EVM-006 AC4, bramka 3)', () => {
  it('EVM-006 AC4: zero packages = empty scan (red); blocking findings are listed', () => {
    assert.equal(osvVerdict({ results: [] }).passed, false);
    const report = {
      results: [
        {
          packages: [
            {
              package: { name: 'p', version: '1.0.0' },
              groups: [{ ids: ['MAL-2026-9'] }],
              vulnerabilities: [{ id: 'MAL-2026-9', affected: [] }],
            },
          ],
        },
      ],
    };
    const verdict = osvVerdict(report);
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.problems, ['MAL-2026-9 · p@1.0.0 · pakiet złośliwy']);
  });
});

describe('Trivy verdicts (EVM-006 AC4, bramki 4 i 5)', () => {
  it('EVM-006 AC4: config — HIGH/CRITICAL failures block, LOW is a report; a scan without a Dockerfile fails', () => {
    /** @param {unknown[]} misconfigurations */
    const report = (misconfigurations) => ({ Results: [{ Target: 'docker/x/Dockerfile', Misconfigurations: misconfigurations }] });
    assert.equal(trivyConfigVerdict(report([{ ID: 'DS-0026', Severity: 'LOW', Status: 'FAIL' }])).passed, true);
    const red = trivyConfigVerdict(
      report([
        { ID: 'DS-0002', Severity: 'HIGH', Status: 'FAIL' },
        { ID: 'DS-0001', Severity: 'HIGH', Status: 'PASS' },
      ]),
    );
    assert.deepEqual(red.problems, ['DS-0002 (HIGH) · docker/x/Dockerfile']);
    assert.equal(trivyConfigVerdict({ Results: [] }).summary, 'pusty cel skanu (brak Dockerfile w wyniku)');
  });

  it('EVM-006 AC4: licenses — only the allow-list (with OFL-1.1) passes; a scan without a pnpm lockfile fails', () => {
    assert.ok(ALLOWED_LICENSES.includes('OFL-1.1'));
    /** @param {unknown[]} licenses */
    const report = (licenses) => ({
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Type: 'pnpm',
          Packages: [
            { Name: 'a', Version: '1.0.0', Licenses: ['MIT'] },
            { Name: 'font', Version: '2.0.0', Licenses: ['OFL-1.1'] },
            { Name: 'g', Version: '3.0.0', Licenses: ['GPL-3.0-only'] },
          ],
        },
        { Target: 'pnpm-lock.yaml', Class: 'license', Licenses: licenses },
      ],
    });
    assert.equal(
      trivyLicenseVerdict(
        report([
          { Name: 'MIT', PkgName: 'a' },
          { Name: 'OFL-1.1', PkgName: 'font' },
        ]),
      ).passed,
      true,
    );
    assert.deepEqual(trivyLicenseVerdict(report([{ Name: 'GPL-3.0-only', PkgName: 'g' }])).problems, ['GPL-3.0-only · g']);
    assert.equal(trivyLicenseVerdict({ Results: [] }).passed, false);
  });

  it('EVM-006 AC4 (security review): a production dependency without a license is an unknown license — red, named in the report', () => {
    /** @param {unknown[]} packages @param {unknown[]} [licenses] */
    const report = (packages, licenses = []) => ({
      Results: [
        { Target: 'pnpm-lock.yaml', Class: 'lang-pkgs', Type: 'pnpm', Packages: packages },
        { Target: 'pnpm-lock.yaml', Class: 'license', Licenses: licenses },
        // Lockfiles of other ecosystems inside node_modules (e.g. examples of a package) are not dependencies.
        {
          Target: 'node_modules/x/examples/Podfile.lock',
          Class: 'lang-pkgs',
          Type: 'cocoapods',
          Packages: [{ Name: 'Pod', Version: '0.1.0' }],
        },
      ],
    });
    const red = trivyLicenseVerdict(
      report([
        { Name: 'licensed', Version: '1.0.0', Licenses: ['MIT'] },
        { Name: 'selftest-unlicensed-fixture', Version: '1.0.0' },
        { Name: 'empty', Version: '2.0.0', Licenses: [''] },
        { Name: 'selftest-unlicensed-fixture', Version: '1.0.0' },
      ]),
    );
    assert.equal(red.passed, false);
    assert.deepEqual(red.problems, ['licencja nieznana · selftest-unlicensed-fixture@1.0.0', 'licencja nieznana · empty@2.0.0']);
    assert.match(red.summary, /nieznane: 2/);
    // A license reported only in the license class counts as known.
    const known = trivyLicenseVerdict(report([{ Name: 'b', Version: '1.0.0' }], [{ Name: 'ISC', PkgName: 'b' }]));
    assert.equal(known.passed, true, known.problems.join('\n'));
    // No package list (e.g. changed Trivy flags) is an empty scan — red, never a silent pass.
    assert.equal(trivyLicenseVerdict(report([])).summary, 'pusty cel skanu (0 pakietów pnpm)');
  });

  it('EVM-006 AC4: SPDX expressions — OR needs one allowed alternative, AND needs all', () => {
    assert.equal(licenseAllowed('(MIT OR GPL-3.0-only)'), true);
    assert.equal(licenseAllowed('MIT AND GPL-3.0-only'), false);
    assert.equal(licenseAllowed('MIT AND ISC'), true);
    assert.equal(licenseAllowed('LicenseRef-unknown'), false);
  });
});

describe('workflow verdicts (EVM-006 AC4, bramka 5a)', () => {
  it('EVM-006 AC4: zizmor — every not-ignored finding blocks; a malformed report fails', () => {
    const finding = {
      ident: 'template-injection',
      determinations: { severity: 'High' },
      locations: [{ symbolic: { key: { Local: { verbatim_path: '.github/workflows/ci.yml' } } } }],
      ignored: false,
    };
    assert.deepEqual(zizmorVerdict([finding, { ...finding, ignored: true }]).problems, [
      'template-injection (High) · .github/workflows/ci.yml',
    ]);
    assert.equal(zizmorVerdict([]).passed, true);
    assert.equal(zizmorVerdict({}).passed, false);
  });

  it('EVM-006 AC4: actionlint — every error blocks; a malformed report fails', () => {
    assert.deepEqual(actionlintVerdict([{ kind: 'syntax-check', filepath: 'w.yml', line: 3, message: 'bad' }]).problems, [
      'syntax-check · w.yml:3 · bad',
    ]);
    assert.equal(actionlintVerdict([]).passed, true);
    assert.equal(actionlintVerdict('x').passed, false);
  });
});
