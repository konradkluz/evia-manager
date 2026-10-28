// @ts-check
/**
 * Monitoring of availability (EVM-085 AC3; architect 7): the checks of Grafana Synthetic Monitoring and the free limit of executions
 * (check x probe x run). Run in the deploy-sh-tests container.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const checks = JSON.parse(readFileSync(fileURLToPath(new URL('../synthetic/checks.json', import.meta.url)), 'utf8'));

describe('EVM-085 AC3 synthetic checks', () => {
  it('EVM-085 AC3 both /healthz and the panel of staging over HTTPS, with a status and a failure threshold', () => {
    const urls = checks.checks.map((/** @type {{ url: string }} */ check) => check.url);
    assert.deepEqual(urls, ['https://staging.eviacharge.pl/healthz', 'https://staging.eviacharge.pl/']);
    for (const check of checks.checks) assert.equal(check.expectStatus, 200);
    assert.ok(checks.failuresBeforeAlert >= 2 && checks.failuresBeforeAlert <= 5);
    assert.ok(checks.timeoutSeconds <= 30);
    assert.equal(checks.env, 'staging');
  });

  it('EVM-085 AC3 (architect 7) the monthly executions stay at or below 80% of the free limit, in the longest month', () => {
    const runsPerProbePerMonth = (31 * 24 * 3600) / checks.intervalSeconds;
    const executions = checks.checks.length * checks.probes.length * runsPerProbePerMonth;
    assert.ok(executions <= checks.freeExecutionsPerMonth * checks.maxShareOfLimit, `${String(executions)} executions`);
    assert.ok(checks.maxShareOfLimit <= 0.8);
    assert.equal(checks.freeExecutionsPerMonth, 100000);
    assert.match(checks.limitCheckedOn, /^\d{4}-\d{2}-\d{2}$/u);
  });

  it('EVM-085 AC3 positive control: the arithmetic rejects the setup of the architect example (2 checks, 3 probes, every minute)', () => {
    const executions = 2 * 3 * ((31 * 24 * 3600) / 60);
    assert.ok(executions > 100000);
  });

  it('EVM-085 AC3 the limit and the date are written in the cost document', () => {
    const costs = readFileSync(fileURLToPath(new URL('../../../docs/ops/koszty-staging.md', import.meta.url)), 'utf8');
    assert.match(costs, /100 000 wykonań/u);
    assert.match(costs, new RegExp(checks.limitCheckedOn, 'u'));
    assert.match(costs, /59 520/u);
  });
});
