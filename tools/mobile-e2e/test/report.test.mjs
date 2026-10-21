import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildReport, isGreen, scanLogcat } from '../src/report.mjs';

/** @returns {import('../src/report.mjs').Evidence} */
function evidence(overrides = {}) {
  return {
    date: '2026-10-20',
    device: { serial: 'emulator-5554', apiLevel: '35', androidRelease: '15', model: 'sdk_gphone64_x86_64' },
    maestroVersion: '2.11.0',
    appVersion: '0.1.0',
    results: [
      { scenario: 'online', flow: '01-online.yaml', status: 'passed', seconds: 12.34 },
      { scenario: 'update-required', flow: '04-update-required.yaml', status: 'passed', seconds: 8 },
    ],
    requests: [{ platform: 'android', version: '0.1.0' }],
    logcat: { lines: 120, withAddress: 0, withSecret: 0 },
    ...overrides,
  };
}

describe('report of the smoke test (EVM-009 AC4; ADR-0015)', () => {
  it('EVM-009 AC4: counts addresses and secret-like words in the log of the app but never repeats the lines', () => {
    const counts = scanLogcat(
      'I/ReactNativeJS: start\nW/x: GET https://api.example.test/api/health\nD/y: Authorization: Bearer abc\n\nE/z: token expired\n',
    );
    assert.deepEqual(counts, { lines: 4, withAddress: 1, withSecret: 2 });
    assert.deepEqual(scanLogcat(''), { lines: 0, withAddress: 0, withSecret: 0 });
  });

  it('EVM-009 AC4: the report names the API level of the emulator and the Maestro version', () => {
    const report = buildReport(evidence());
    assert.match(report, /API 35/);
    assert.match(report, /Android 15/);
    assert.match(report, /Maestro: 2\.11\.0/);
    assert.match(report, /Application version in the build: 0\.1\.0/);
    assert.match(report, /2 passed, 0 failed, 0 skipped/);
    assert.match(report, /\| online \| 01-online\.yaml \| passed \| 12\.3 \|/);
    assert.match(report, /X-Client-Version on every request: yes/);
    assert.match(report, /120 lines, 0 with an address, 0 with a secret-like word/);
  });

  it('EVM-009 AC4: a retried flow is explicit in the table and in the list of retried flows, and stays green', () => {
    const retried = evidence({
      results: [
        { scenario: 'online', flow: '01-online.yaml', status: 'passed', seconds: 12.34, attempts: 2 },
        { scenario: 'update-required', flow: '04-update-required.yaml', status: 'passed', seconds: 8, attempts: 1 },
      ],
    });
    const report = buildReport(retried);
    assert.match(report, /\| online \| 01-online\.yaml \| passed \(retried\) \| 12\.3 \|/);
    assert.match(report, /\| update-required \| 04-update-required\.yaml \| passed \| 8\.0 \|/);
    assert.match(report, /^- Retried flows: 01-online\.yaml$/m);
    assert.equal(isGreen(retried), true);
    assert.match(buildReport(evidence()), /^- Retried flows: none$/m);
  });

  it('EVM-009 AC4: failures, skips and a missing log are shown', () => {
    const report = buildReport(
      evidence({
        results: [
          { scenario: 'a', flow: '02-offline.yaml', status: 'failed', seconds: 1 },
          { scenario: 'a', flow: '03-reconnect.yaml', status: 'skipped', seconds: 0 },
        ],
        logcat: null,
        requests: [],
      }),
    );
    assert.match(report, /0 passed, 1 failed, 1 skipped/);
    assert.match(report, /on every request: NO/);
    assert.match(report, /Logcat of the app process: not collected/);
  });

  it('EVM-009 AC4: green means every flow passed, the headers were sent and the log of the app is clean', () => {
    assert.equal(isGreen(evidence()), true);
    assert.equal(isGreen(evidence({ logcat: null })), true);
    assert.equal(isGreen(evidence({ results: [] })), false);
    assert.equal(isGreen(evidence({ results: [{ scenario: 'a', flow: 'f', status: 'failed', seconds: 1 }] })), false);
    assert.equal(isGreen(evidence({ requests: [] })), false);
    assert.equal(isGreen(evidence({ requests: [{ platform: 'ios', version: '0.1.0' }] })), false);
    assert.equal(isGreen(evidence({ requests: [{ platform: 'android', version: undefined }] })), false);
    assert.equal(isGreen(evidence({ logcat: { lines: 3, withAddress: 1, withSecret: 0 } })), false);
    assert.equal(isGreen(evidence({ logcat: { lines: 3, withAddress: 0, withSecret: 1 } })), false);
  });
});
