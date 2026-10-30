import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';

const APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const FLOWS = join(APP, 'e2e');

describe('Maestro flows and scenarios agree (EVM-009 AC4)', () => {
  const referenced = SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.flow));

  it('EVM-009 AC4: every flow of a scenario exists, belongs to the application id of the app and names its acceptance criterion', () => {
    for (const flow of referenced) {
      const text = readFileSync(join(FLOWS, flow), 'utf8');
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      assert.match(text, /^# EVM-(009|093|100) AC\d/m, flow);
    }
  });

  it('EVM-009 AC4: no flow is left out of the scenarios, and no flow is used twice', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => name.endsWith('.yaml'))
      .sort();
    assert.deepEqual([...referenced].sort(), files);
    assert.equal(new Set(referenced).size, referenced.length);
  });

  it('EVM-009 AC4: the application id of the flows is the one the app is built with', () => {
    const config = readFileSync(join(APP, 'plugins', 'expo-config.ts'), 'utf8');
    assert.match(config, new RegExp(`ANDROID_APPLICATION_ID = '${APPLICATION_ID.replaceAll('.', String.raw`\.`)}'`));
  });

  it('EVM-009 AC4: the offline scenario starts without a network and the update scenario raises the minimum version', () => {
    /** @param {string} name @param {number} index */
    const step = (name, index) => SCENARIOS.find((scenario) => scenario.name === name)?.steps.at(index);
    // EVM-100: the shell needs a session, so the scenario signs in with the network first and then starts without it
    assert.equal(step('airplane-mode-and-return', 0)?.flow, '02-sign-in.yaml');
    assert.equal(step('airplane-mode-and-return', 0)?.airplane, false);
    assert.equal(step('airplane-mode-and-return', 1)?.flow, '02-offline.yaml');
    assert.equal(step('airplane-mode-and-return', 1)?.airplane, true);
    assert.equal(step('airplane-mode-and-return', -1)?.airplane, false);
    assert.equal(step('update-required', 0)?.server, 'update');
    assert.equal(step('server-down-and-retry', 0)?.server, 'ok');
    assert.equal(step('server-down-and-retry', 1)?.server, 'down');
  });

  it('EVM-009 AC4: the flows take the review screenshots of the key states, each name once, in kebab-case', () => {
    const names = referenced.flatMap((flow) =>
      [...readFileSync(join(FLOWS, flow), 'utf8').matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1]),
    );
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.match(name ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual(
      [...names].sort(),
      [
        'kolejka-empty',
        'kolejka-offline',
        'nav-kolejka-active',
        'nav-orders-active',
        's01-loading',
        's01-loading-slow',
        's01-offline',
        's01-online',
        's01-reconnected',
        's01-server-back',
        's01-server-down',
        's02-update-required',
        'm01-login',
        'm01-code',
        'm01-wrong-code',
        'm01-rate-limited',
        'm01-offline',
        'm02-role',
        'm02-update',
        'm02-revoked',
        'm02-signed-out',
        'm09-more',
        'm09-logout-dialog',
      ].sort(),
    );
  });

  it('EVM-009 AC1: the loading flow runs last, against a server that holds the health request', () => {
    const steps = SCENARIOS.flatMap((scenario) => scenario.steps);
    const last = steps.at(-1);
    assert.equal(last?.flow, '07-loading.yaml');
    assert.equal(last.server, 'hang');
    assert.equal(last.airplane, false);
  });

  it('EVM-093 AC1, AC3–AC7: the local-store scenarios run before the loading flow, with their device steps in the order of the proof', () => {
    /** @param {string} name */
    const steps = (name) => SCENARIOS.find((scenario) => scenario.name === name)?.steps ?? [];
    assert.deepEqual(
      steps('local-store-encryption').map((step) => step.after),
      [['check-encrypted']],
    );
    // the confirmation of the last append (seed flow) comes before force-stop, then kill -9, then the restart of the emulator
    assert.deepEqual(
      steps('local-store-durability').map((step) => step.after ?? []),
      [['force-stop'], ['kill-9'], ['reboot'], []],
    );
    assert.deepEqual(steps('local-store-backup').at(-1)?.before, ['check-backup-transport', 'adb-backup-start']);
    assert.deepEqual(steps('local-store-backup').at(-1)?.after, ['adb-backup-check']);
    assert.deepEqual(steps('local-store-file-corrupt')[0]?.after, ['force-stop', 'corrupt-db']);
    // the copy before the wipe, then the copy of the current database for the positive control
    assert.deepEqual(
      steps('local-store-wipe').map((step) => step.after ?? []),
      [['copy-db'], ['copy-db'], []],
    );
    const names = SCENARIOS.map((scenario) => scenario.name);
    for (const name of [
      'local-store-encryption',
      'local-store-durability',
      'local-store-backup',
      'local-store-key-missing',
      'local-store-file-corrupt',
      'local-store-wipe',
      'local-store-owner',
    ])
      assert.ok(names.indexOf(name) >= 0 && names.indexOf(name) < names.indexOf('loading'), name);
  });

  it('EVM-093 AC3: the seed flow shows the count after the LAST append resolved, the later flows find all 20 entries', () => {
    const seed = readFileSync(join(FLOWS, '09-durability-seed.yaml'), 'utf8');
    assert.match(seed.trimEnd(), /text: 'open=unlocked;appended=1;queue=20'\s+timeout: \d+$/);
    for (const flow of ['09-durability-force-stop.yaml', '09-durability-kill.yaml', '09-durability-reboot.yaml']) {
      const text = readFileSync(join(FLOWS, flow), 'utf8');
      assert.match(text, /text: 'open=unlocked;queue=20;identity=kept;pull=no'/, flow);
      assert.doesNotMatch(text, /clearState/, flow);
    }
  });

  it('EVM-100 AC1: every flow that needs the shell signs in first (shared subflow) and every sub-flow it runs exists', () => {
    for (const flow of referenced) {
      const text = readFileSync(join(FLOWS, flow), 'utf8');
      for (const match of text.matchAll(/^- runFlow: (\S+)$/gm))
        assert.ok(readdirSync(join(FLOWS, 'common')).includes((match[1] ?? '').replace('common/', '')), flow);
    }
    for (const flow of ['01-online.yaml', '04-update-required.yaml', '20-login-ok.yaml', '22-login-role.yaml', '26-logout-online.yaml'])
      assert.match(
        readFileSync(join(FLOWS, flow), 'utf8'),
        /clearState: true[\s\S]*(runFlow: common\/sign-in\.yaml|id: 'login-email')/,
        flow,
      );
    const signIn = readFileSync(join(FLOWS, 'common', 'sign-in.yaml'), 'utf8');
    assert.match(signIn, /inputText: 'technik@example\.test'/);
    assert.match(signIn, /inputText: '123456'/);
  });

  it('EVM-100 AC2–AC4: the sign-in modes of the scenario server are set for the steps that need them', () => {
    const modes = SCENARIOS.flatMap((scenario) => scenario.steps).filter((step) => step.auth !== undefined);
    assert.deepEqual(
      modes.map((step) => [step.flow, step.auth]),
      [
        ['21-login-rate-limited.yaml', 'rate_limited'],
        ['22-login-role.yaml', 'channel_not_allowed'],
        ['22-login-update.yaml', 'version_unsupported'],
        ['23-session-revoked.yaml', 'session_revoked'],
      ],
    );
    /** @param {string} name */
    const airplane = (name) => SCENARIOS.find((scenario) => scenario.name === name)?.steps.map((step) => step.airplane);
    assert.deepEqual(airplane('sign-in-offline'), [true, false]);
    assert.deepEqual(airplane('sign-out'), [false, true, false]);
  });

  it('EVM-093 AC1: the flows reach the hooks by the testIDs of the hook panel only, and the panel carries the marker of verify', () => {
    const panel = readFileSync(join(APP, 'src', 'e2e-hooks', 'panel.tsx'), 'utf8');
    const ids = new Set([...panel.matchAll(/testID="([^"]+)"/g)].map((match) => match[1]));
    ids.add('evia-e2e-hooks-panel');
    ids.add('local-data-lost');
    ids.add('local-data-lost-ack');
    /** @type {Set<string>} */
    const used = new Set();
    for (const flow of readdirSync(FLOWS).filter((name) => /^(0[89]|1[0-4])-/.test(name))) {
      for (const match of readFileSync(join(FLOWS, flow), 'utf8').matchAll(/id: '([^']+)'/g)) used.add(match[1] ?? '');
    }
    for (const id of used) assert.ok(ids.has(id), `unknown testID ${id}`);
    assert.match(panel, /export const E2E_HOOKS_MARKER = 'evia-e2e-hooks-panel';/);
  });
});
