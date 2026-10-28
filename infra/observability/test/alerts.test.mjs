// @ts-check
/**
 * Consistency of the alert layer (EVM-085 AC2, AC5, AC8; architect 5, 6; security A14). Run in the deploy-sh-tests container
 * (docker compose -f compose.yaml run --rm deploy-sh-tests); the promtool cases themselves: promtool-tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseThresholds, render, renderFromDisk } from '../render-rules.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (/** @type {string} */ path) => readFileSync(`${root}${path}`, 'utf8');
const rules = read('alerts/rules.yaml');
const template = read('alerts/rules.tmpl.yaml');
const promtool = read('alerts/tests/rules.test.yaml');
const runbook = readFileSync(`${root}../../docs/ops/runbooks/alerty.md`, 'utf8');
const alerts = [...rules.matchAll(/^ {6}- alert: (\w+)$/gmu)].map((m) => m[1] ?? '');

const AC2_ITEMS = [
  'heartbeat',
  'head-mismatch',
  'v0-block',
  'token-expiry',
  'api-limit',
  'backup',
  'restore-resources',
  'no-data',
  'usage-limits',
];

describe('EVM-085 AC2 rules', () => {
  it('EVM-085 AC2 rules.yaml is the rendering of the template and the thresholds (no stale copy)', () => {
    assert.equal(rules, renderFromDisk());
  });

  it('EVM-085 AC2 every item of the AC2 list has at least one alert', () => {
    for (const item of AC2_ITEMS) assert.match(rules, new RegExp(`ac2: ${item} `, 'u'), item);
  });

  it('EVM-085 AC2 every alert is covered by a promtool case', () => {
    assert.ok(alerts.length >= 13);
    for (const name of alerts) assert.match(promtool, new RegExp(`alertname: ${name}$`, 'mu'), name);
  });

  it('EVM-085 AC2 only staging series are evaluated (no prod alerts in this story)', () => {
    assert.doesNotMatch(rules, /env="prod"/u);
    for (const match of rules.matchAll(/^ {8}expr: (.*)$/gmu)) assert.doesNotMatch(match[1] ?? '', /env=~/u);
  });
});

describe('EVM-085 AC5 thresholds live in one place', () => {
  it('EVM-085 AC5 the template has no numeric comparison literal (only thresholds.yaml keys)', () => {
    for (const line of template.split('\n')) {
      if (line.trimStart().startsWith('#')) continue;
      assert.doesNotMatch(line, /[<>]=?\s*[2-9]\d*\b(?!\s*\*\s*86400)/u, line);
      assert.doesNotMatch(line, /[<>]=?\s*1\d+\b/u, line);
    }
  });

  it('EVM-085 AC5 an unknown or an unused threshold is an error', () => {
    assert.throws(() => render('x ${missing}', {}), /unknown threshold missing/u);
    assert.throws(() => render('x', { spare: '1' }), /unused thresholds: spare/u);
    assert.throws(() => parseThresholds('bad line'), /unsupported line/u);
    assert.throws(() => parseThresholds('a: 1\na: 2'), /duplicate key a/u);
  });

  it('EVM-085 AC5 the thresholds of EVM-026 spikes are not duplicated in the alert layer', () => {
    const thresholds = read('alerts/thresholds.yaml');
    assert.doesNotMatch(thresholds, /^(login_failure|second_step)[a-z_]*:/mu);
  });
});

describe('EVM-085 AC8 runbook', () => {
  it('EVM-085 AC8 every alert has a section and the runbook anchor of the rule points to it', () => {
    for (const name of alerts) {
      assert.match(runbook, new RegExp(`^## ${name}$`, 'mu'), `section of ${name}`);
      assert.ok(rules.includes(`alerty.md#${name.toLowerCase()}`), `anchor of ${name}`);
    }
  });

  it('EVM-085 AC8 every section has a meaning, a first reaction, an escalation and a test', () => {
    for (const name of alerts) {
      const start = runbook.indexOf(`## ${name}\n`);
      const next = runbook.indexOf('\n## ', start + 1);
      const section = runbook.slice(start, next === -1 ? undefined : next);
      for (const field of ['Znaczenie', 'Pierwsza reakcja', 'Eskalacja', 'Test']) {
        assert.ok(section.includes(`**${field}:**`), `${name}: ${field}`);
      }
    }
  });

  it('EVM-085 AC8 the rotation of the Grafana write token and the Sentry DSN is described, also after an incident', () => {
    assert.match(runbook, /^## Rotacja tokenu zapisu Grafana/mu);
    assert.match(runbook, /^## Rotacja DSN Sentry/mu);
    assert.equal((runbook.match(/Po incydencie na staging/giu) ?? []).length >= 2, true);
  });
});

describe('EVM-085 AC2 notifications carry no log content (security A14)', () => {
  it('EVM-085 AC2 annotations use only env, alertCode and token labels', () => {
    for (const match of rules.matchAll(/\{\{\s*([^}]*?)\s*\}\}/gu)) {
      assert.match(match[1] ?? '', /^\$labels\.(env|alertCode|token)$/u, match[0]);
    }
    assert.doesNotMatch(rules, /\$value|\$externalLabels|\.Labels|humanize/u);
  });

  it('EVM-085 AC2 the observability directory has no file with an unexpected secret-like name', () => {
    const names = readdirSync(root, { recursive: true, encoding: 'utf8' });
    for (const name of names) assert.doesNotMatch(name, /\.(env|pem|key)$/u, name);
  });
});
