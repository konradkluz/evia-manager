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
      assert.match(text, /^# EVM-009 AC\d/m, flow);
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
    assert.equal(step('airplane-mode-and-return', 0)?.airplane, true);
    assert.equal(step('airplane-mode-and-return', -1)?.airplane, false);
    assert.equal(step('update-required', 0)?.server, 'update');
    assert.equal(step('server-down-and-retry', 0)?.server, 'down');
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
        's01-loading',
        's01-loading-slow',
        's01-offline',
        's01-online',
        's01-reconnected',
        's01-server-back',
        's01-server-down',
        's02-update-required',
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
});
