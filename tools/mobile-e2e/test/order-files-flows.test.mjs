import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { CAMERA_SCENARIOS } from '../src/camera-scenarios.mjs';
import { ORDER_FILES_SCENARIOS } from '../src/order-files-scenarios.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { SURVEY_SCENARIOS } from '../src/survey-scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';
import { VIDEO_SCENARIOS } from '../src/video-scenarios.mjs';

const FLOWS = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile', 'e2e');
const LOCAL_ACTIONS = new Set(['force-stop', 'kill-9', 'reboot']);
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
/**
 * @param {readonly import('../src/scenarios.mjs').Scenario[]} list @param {string} name
 * @returns {import('../src/scenarios.mjs').Scenario}
 */
const scenarioOf = (list, name) => {
  const found = list.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, name);
  return found;
};
/**
 * @param {import('../src/scenarios.mjs').Scenario} of @param {number} index
 * @returns {import('../src/scenarios.mjs').Step}
 */
const stepAt = (of, index) => {
  const found = of.steps[index];
  assert.ok(found !== undefined, `step ${String(index)}`);
  return found;
};
const scenario = scenarioOf(ORDER_FILES_SCENARIOS, 'order-files-status');
const steps = ORDER_FILES_SCENARIOS.flatMap((candidate) => candidate.steps);
const OWN = [...new Set(steps.map((step) => step.flow))].filter((flow) => /^12\d-/.test(flow)).sort();

describe('Maestro flows 120-129 and the scenario "order-files-status" agree (EVM-111)', () => {
  it('EVM-111 AC1: the flows 12x are exactly the flows of the scenario (none left out), each with the application id and a header that names its criteria', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^12\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(OWN, files);
    assert.equal(OWN.length, 3);
    for (const flow of [...OWN, 'common/order-files-open.yaml']) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      assert.match(text, /^# EVM-111 AC\d/m, flow);
    }
    for (const flow of OWN) {
      const claimed = /^# EVM-111 (AC\d(?: AC\d)*)/m.exec(flowText(flow))?.[1] ?? '';
      for (const ac of claimed.split(' ')) assert.match(scenario.ac, new RegExp(String.raw`\b${ac}\b`), `${flow} claims ${ac}`);
    }
  });

  it('EVM-111 AC1 AC5: the scenario signs in, goes offline, back online, and then the server confirms - the last step comes back to the foreground to read it', () => {
    assert.equal(scenario.name, 'order-files-status');
    assert.deepEqual(
      scenario.steps.map((step) => [step.flow, step.airplane, step.background === true]),
      [
        ['80-camera-sign-in.yaml', false, false],
        ['120-order-files-offline.yaml', true, false],
        ['120-order-files-sending.yaml', false, false],
        ['120-order-files-confirmed.yaml', false, true],
      ],
    );
    for (const step of steps) assert.equal(step.upload, true, step.flow);
    assert.deepEqual(stepAt(scenario, 0).before, ['upload-reset', 'logcat-clear', 'upload-part-delay:0']);
    // offline: no byte reached the server and nothing is armed
    assert.deepEqual(stepAt(scenario, 1).after, ['jobs-none', 'upload-none-yet']);
    // the transfer ended and the server has the objects, but nothing confirmed them: the originals are still on the phone
    assert.deepEqual(stepAt(scenario, 2).after, ['upload-checkpoint-many:2', 'original-present']);
    // the confirmation: the originals go, the log and the files of the app hold no token
    assert.deepEqual(stepAt(scenario, 3).before, ['upload-file-state:clean']);
    assert.deepEqual(stepAt(scenario, 3).after, ['original-absent', 'tokens-not-in-clear', 'logcat-clean']);
  });

  it('EVM-111 AC2 AC3 AC5 AC6: what the flows ask of the screens - the row and the header with the same number, the empty sentence without a button, nothing sent as "Wysłano"', () => {
    const offline = flowText('120-order-files-offline.yaml');
    for (const part of [
      "text: '2 do wysłania'",
      "id: 'order-files-row'",
      "id: 'order-files-count'",
      "assertVisible: '.*, Zdjęcie, .*, Oczekuje'",
      "id: 'order-files-back'",
    ])
      assert.ok(offline.includes(part), part);
    assert.match(offline, /COUNT: '2'/);
    const sending = flowText('120-order-files-sending.yaml');
    assert.match(sending, /text: '2 do wysłania'/);
    assert.match(sending, /assertNotVisible: '\.\*, Zdjęcie, \.\*, Wysłano'/);
    const confirmed = flowText('120-order-files-confirmed.yaml');
    for (const part of [
      "text: 'Wszystko wysłane'",
      "id: 'order-files-empty'",
      'Wszystko wysłane\\. Zdjęcia i filmy zlecenia przegląda biuro w panelu\\.',
      "id: 'queue-files'",
      "STATUS: 'files=0;waiting=0;uploading=0;failed=0;attention=0;notifications=[a-z_]+'",
    ])
      assert.ok(confirmed.includes(part), part);
    // the screen of the files is judged without a coordinate
    for (const flow of [...OWN, 'common/order-files-open.yaml']) assert.doesNotMatch(flowText(flow), /\bpoint:|^- tapOn: \d/m, flow);
  });

  it('EVM-111 AC5: the flow that waits for the confirmation of the file in the Queue (54-upload-confirmed) expects the entry to be GONE - no row of a file', () => {
    const text = flowText('54-upload-confirmed.yaml');
    assert.match(text, /notVisible:\n {6}id: 'queue-files'/);
    assert.match(text, /^# EVM-130 AC4/m);
    const original = scenarioOf(UPLOAD_SCENARIOS, 'upload-original-until-clean');
    assert.deepEqual(
      original.steps.map((step) => step.flow),
      ['50-upload-sign-in.yaml', '55-upload-inject-small.yaml', '54-upload-sent.yaml', '54-upload-confirmed.yaml'],
    );
    assert.deepEqual(stepAt(original, 3).before, ['upload-file-state:clean']);
    assert.deepEqual(stepAt(original, 3).after, ['original-absent']);
    // no flow waits for a row "Wysłano" any more (there is none on the phone)
    for (const flow of readdirSync(FLOWS).filter((name) => name.endsWith('.yaml')))
      assert.doesNotMatch(flowText(flow), /visible: '[^']*, Wysłano'|visible: '\.\*Wysłano'/, flow);
  });

  it('EVM-111: the scenario is outside the default run, runs with `--only order-files`, and no other family of scenarios pulls it in or uses its flows', () => {
    assert.equal(
      SCENARIOS.some((candidate) => candidate.name.startsWith('order-files')),
      false,
    );
    assert.deepEqual(
      selectScenarios(['order-files']).map((candidate) => candidate.name),
      ['order-files-status'],
    );
    for (const word of ['camera-', 'upload-', 'video-', 'survey-'])
      assert.equal(
        selectScenarios([word]).some((candidate) => candidate.name.startsWith('order-files')),
        false,
        word,
      );
    const others = new Set(
      [...SCENARIOS, ...UPLOAD_SCENARIOS, ...CAMERA_SCENARIOS, ...VIDEO_SCENARIOS, ...SURVEY_SCENARIOS].flatMap((candidate) =>
        candidate.steps.map((step) => step.flow),
      ),
    );
    for (const flow of OWN) assert.equal(others.has(flow), false, flow);
  });

  it('EVM-111: every step of the scenario is a known step of the device tools', () => {
    for (const step of steps)
      for (const action of [...(step.before ?? []), ...(step.after ?? [])])
        assert.ok(isUploadAction(action) || isCameraAction(action) || LOCAL_ACTIONS.has(action), `${step.flow}: ${action}`);
  });
});
