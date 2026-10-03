// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateOsv } from '../lib/osv.mjs';

/**
 * @param {{ id: string, aliases?: string[], severity?: string, fixed?: boolean, otherPackage?: boolean }} vulnerability
 */
const vulnerability = ({ id, aliases = [], severity, fixed = true, otherPackage = false }) => ({
  id,
  aliases,
  database_specific: severity === undefined ? {} : { severity },
  affected: [
    {
      package: { ecosystem: 'npm', name: otherPackage ? 'other' : 'synthetic-pkg' },
      ranges: [{ type: 'SEMVER', events: fixed ? [{ introduced: '0' }, { fixed: '2.0.0' }] : [{ introduced: '0' }] }],
    },
  ],
});

/**
 * @param {Array<{ ids: string[], aliases?: string[], max_severity?: string }>} groups
 * @param {ReturnType<typeof vulnerability>[]} vulnerabilities
 */
const report = (groups, vulnerabilities) => ({
  results: [
    {
      source: { path: '/src/pnpm-lock.yaml', type: 'lockfile' },
      packages: [
        { package: { name: 'synthetic-pkg', version: '1.0.0', ecosystem: 'npm' }, groups, vulnerabilities },
        { package: { name: 'clean-pkg', version: '1.0.0', ecosystem: 'npm' }, groups: [], vulnerabilities: [] },
      ],
    },
  ],
});

describe('OSV threshold (EVM-006 AC4, bramka 3, A5)', () => {
  it('EVM-006 AC4: High with an available fix blocks; packages are counted (an empty scan is detectable)', () => {
    const { packages, findings } = evaluateOsv(
      report([{ ids: ['GHSA-aaaa'], max_severity: '8.1' }], [vulnerability({ id: 'GHSA-aaaa', severity: 'HIGH' })]),
    );
    assert.equal(packages, 2);
    assert.deepEqual(findings, [
      { package: 'synthetic-pkg@1.0.0', ids: ['GHSA-aaaa'], severity: '8.1', fixAvailable: true, malicious: false, blocking: true },
    ]);
  });

  it('EVM-006 AC4: Medium with a fix and High without a fix are reported, not blocking', () => {
    const medium = evaluateOsv(report([{ ids: ['GHSA-m'], max_severity: '5.3' }], [vulnerability({ id: 'GHSA-m', severity: 'MODERATE' })]));
    assert.equal(medium.findings[0]?.blocking, false);
    const unfixed = evaluateOsv(
      report([{ ids: ['GHSA-h'], max_severity: '9.8' }], [vulnerability({ id: 'GHSA-h', severity: 'CRITICAL', fixed: false })]),
    );
    const [unfixedFinding] = unfixed.findings;
    assert.ok(unfixedFinding);
    assert.equal(unfixedFinding.blocking, false);
    assert.equal(unfixedFinding.fixAvailable, false);
  });

  it('EVM-006 AC4: a fix for another package does not count as a fix for this one', () => {
    const { findings } = evaluateOsv(
      report([{ ids: ['GHSA-o'], max_severity: '9.0' }], [vulnerability({ id: 'GHSA-o', otherPackage: true })]),
    );
    const [finding] = findings;
    assert.ok(finding);
    assert.equal(finding.fixAvailable, false);
    assert.equal(finding.blocking, false);
  });

  it('EVM-006 AC4: a database severity HIGH blocks even when the CVSS score is lower', () => {
    const { findings } = evaluateOsv(
      report([{ ids: ['GHSA-d'], max_severity: '6.5' }], [vulnerability({ id: 'GHSA-d', severity: 'HIGH' })]),
    );
    assert.equal(findings[0]?.blocking, true);
  });

  it('EVM-006 AC4: no CVSS score and no severity with an available fix → treated as High (fail closed)', () => {
    const { findings } = evaluateOsv(report([{ ids: ['GHSA-u'] }], [vulnerability({ id: 'GHSA-u' })]));
    const [finding] = findings;
    assert.ok(finding);
    assert.equal(finding.severity, 'unknown');
    assert.equal(finding.blocking, true);
  });

  it('EVM-006 AC4: without a score the database severity is used (LOW stays a report)', () => {
    const { findings } = evaluateOsv(report([{ ids: ['GHSA-l'] }], [vulnerability({ id: 'GHSA-l', severity: 'LOW' })]));
    const [finding] = findings;
    assert.ok(finding);
    assert.equal(finding.severity, 'LOW');
    assert.equal(finding.blocking, false);
  });

  it('EVM-006 AC4: every malicious package (MAL-…) blocks, also without a fix and when only an alias is MAL-', () => {
    const direct = evaluateOsv(report([{ ids: ['MAL-2026-1'] }], [vulnerability({ id: 'MAL-2026-1', fixed: false })]));
    const [directFinding] = direct.findings;
    assert.ok(directFinding);
    assert.equal(directFinding.malicious, true);
    assert.equal(directFinding.blocking, true);
    const alias = evaluateOsv(
      report([{ ids: ['GHSA-x'], aliases: ['MAL-2026-2'], max_severity: '1.0' }], [vulnerability({ id: 'GHSA-x', fixed: false })]),
    );
    assert.equal(alias.findings[0]?.blocking, true);
  });

  it('EVM-006 AC4: an unexpected report shape yields no packages (the gate then fails as an empty scan)', () => {
    assert.deepEqual(evaluateOsv(null), { packages: 0, findings: [] });
    assert.deepEqual(evaluateOsv({ results: [{ packages: [{}] }] }), { packages: 1, findings: [] });
  });
});
