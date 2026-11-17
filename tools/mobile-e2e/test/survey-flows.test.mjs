import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isSurveyAction } from '../src/device-survey.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { CAMERA_SCENARIOS } from '../src/camera-scenarios.mjs';
import { VIDEO_SCENARIOS } from '../src/video-scenarios.mjs';
import { SURVEY_SCENARIOS } from '../src/survey-scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';

const FLOWS = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile', 'e2e');
const LOCAL_ACTIONS = new Set(['force-stop', 'kill-9', 'reboot']);
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = SURVEY_SCENARIOS.flatMap((scenario) => scenario.steps);
const surveyFlows = [...new Set(steps.map((step) => step.flow))].sort();
const COMMON = ['common/survey-create.yaml'];
/** @param {string} name */
const scenarioOf = (name) => {
  const found = SURVEY_SCENARIOS.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, name);
  return found;
};
const SURVEY_MODES = ['ok', 'feature_disabled', 'validation_failed', 'deleted', 'assigned'];

describe('Maestro flows 110-116 and the survey scenarios agree (EVM-137)', () => {
  it('EVM-137 AC1: every flow of a survey scenario exists, belongs to the application id and names, in its header, the criteria that the scenarios using it state', () => {
    /** @type {Map<string, string>} */
    const stated = new Map();
    for (const scenario of SURVEY_SCENARIOS)
      for (const step of scenario.steps) stated.set(step.flow, `${stated.get(step.flow) ?? ''} ${scenario.ac}`);
    for (const [flow, acs] of stated) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      const claimed = /^# EVM-137 (AC\d(?: AC\d)*)/m.exec(text)?.[1];
      assert.ok(claimed !== undefined, `${flow}: no "# EVM-137 AC<n>" header`);
      for (const ac of claimed.split(' ')) assert.match(acs, new RegExp(String.raw`\b${ac}\b`), `${flow} claims ${ac}`);
    }
    for (const flow of COMMON) {
      assert.match(flowText(flow), /^# EVM-137 AC\d/m, flow);
      assert.match(flowText(flow), new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
    }
  });

  it('EVM-137 AC1: the flows 110-119 are exactly the flows of the survey scenarios (none left out), and no other scenario uses them', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^11\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(surveyFlows, files);
    const others = new Set(
      [...SCENARIOS, ...UPLOAD_SCENARIOS, ...CAMERA_SCENARIOS, ...VIDEO_SCENARIOS].flatMap((scenario) =>
        scenario.steps.map((step) => step.flow),
      ),
    );
    for (const flow of surveyFlows) assert.equal(others.has(flow), false, flow);
    assert.equal(surveyFlows.length, 12);
  });

  it('EVM-137 AC1: every survey scenario is outside the default run, resets the scenario server, signs in through the upload part and uses known steps and modes only', () => {
    const names = SURVEY_SCENARIOS.map((scenario) => scenario.name);
    assert.equal(new Set(names).size, names.length);
    for (const scenario of SURVEY_SCENARIOS) {
      assert.ok(scenario.name.startsWith('survey-'), scenario.name);
      const first = /** @type {NonNullable<(typeof scenario.steps)[number]>} */ (scenario.steps[0]);
      assert.ok(['110-survey-sign-in.yaml', '116-survey-feature-off.yaml'].includes(first.flow), scenario.name);
      assert.equal(first.airplane, false, scenario.name);
      assert.deepEqual(
        first.before?.slice(0, 2),
        ['upload-reset', 'logcat-clear'].slice(0, first.before?.length === undefined ? 0 : 2),
        scenario.name,
      );
      for (const step of scenario.steps) {
        assert.equal(step.upload, true, `${scenario.name} ${step.flow}`);
        assert.ok(SURVEY_MODES.includes(step.survey ?? 'ok'), `${step.flow}: ${String(step.survey)}`);
        assert.ok(['on', 'off'].includes(step.features ?? 'on'), `${step.flow}: ${String(step.features)}`);
      }
    }
    for (const step of steps)
      for (const action of [...(step.before ?? []), ...(step.after ?? [])])
        assert.ok(
          isUploadAction(action) || isCameraAction(action) || isSurveyAction(action) || LOCAL_ACTIONS.has(action),
          `${step.flow}: ${action}`,
        );
    assert.equal(
      SCENARIOS.some((scenario) => scenario.name.startsWith('survey-')),
      false,
    );
    assert.deepEqual(
      selectScenarios(['survey-']).map((scenario) => scenario.name),
      names,
    );
    // `--only camera-` and `--only upload-` do not pull the survey scenarios in
    for (const word of ['camera-', 'upload-', 'video-'])
      assert.equal(
        selectScenarios([word]).some((scenario) => scenario.name.startsWith('survey-')),
        false,
        word,
      );
  });

  it('EVM-137 AC1 .. AC7: the scenarios together cover every criterion', () => {
    const covered = new Set(SURVEY_SCENARIOS.flatMap((scenario) => [...scenario.ac.matchAll(/AC\d/g)].map((match) => match[0])));
    assert.deepEqual([...covered].sort(), ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7']);
  });

  it('EVM-137 AC2: the offline scenario kills the app, comes back offline and proves the send: 2 unique, 0 duplicates, 0 rejected, a clean log', () => {
    const scenario = scenarioOf('survey-offline');
    assert.deepEqual(
      scenario.steps.map((step) => [step.flow, step.airplane]),
      [
        ['110-survey-sign-in.yaml', false],
        ['111-survey-offline.yaml', true],
        ['111-survey-restart.yaml', true],
        ['111-survey-return.yaml', false],
      ],
    );
    assert.deepEqual(scenario.steps[1]?.after, ['force-stop']);
    assert.deepEqual(scenario.steps[3]?.expectSync, { unique: 2, duplicates: 0, rejected: 0 });
    assert.ok((scenario.steps[3].after ?? []).includes('logcat-no-survey-data'));
  });

  it('EVM-137 AC6: the rejection scenarios use the modes of the server and prove the counters (nothing is sent again)', () => {
    const rejected = scenarioOf('survey-rejected').steps.slice(-1)[0];
    assert.ok(rejected !== undefined);
    assert.equal(rejected.survey, 'feature_disabled');
    assert.deepEqual(rejected.expectSync, { unique: 0, duplicates: 0, rejected: 1 });
    const deleted = scenarioOf('survey-deleted').steps.slice(-1)[0];
    assert.ok(deleted !== undefined);
    assert.equal(deleted.survey, 'deleted');
    assert.deepEqual(deleted.expectSync, { unique: 1, duplicates: 0, rejected: 2 });
    const assigned = scenarioOf('survey-assigned').steps.slice(-1)[0];
    assert.ok(assigned !== undefined);
    assert.equal(assigned.survey, 'assigned');
    assert.equal(scenarioOf('survey-feature-off').steps[0]?.features, 'off');
  });

  it('EVM-137 AC1: the review screenshots of all flows have distinct kebab-case names (they are collected flat)', () => {
    const names = readdirSync(FLOWS)
      .filter((name) => name.endsWith('.yaml'))
      .flatMap((flow) => [...flowText(flow).matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1]));
    assert.equal(new Set(names).size, names.length);
    const own = [...surveyFlows, ...COMMON].flatMap((flow) =>
      [...flowText(flow).matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1] ?? ''),
    );
    assert.ok(own.length >= 20);
    for (const name of own) assert.match(name, /^m\d\d-[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('EVM-137 AC1: the lessons of the earlier flows hold - scrollUntilVisible centres, an id and a text are never in one step, hideKeyboard follows a typed text, a sentence in a regex has its dot and question mark escaped', () => {
    for (const flow of [...surveyFlows, ...COMMON]) {
      const text = flowText(flow);
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/^\s*-?\s*scrollUntilVisible:/.test(line)) {
          const block = lines.slice(index, index + 8).join('\n');
          assert.match(block, /centerElement: true/, `${flow}:${String(index + 1)} scrollUntilVisible without centerElement`);
        }
        if (/^\s*- hideKeyboard\s*$/.test(line)) {
          const before = lines
            .slice(0, index)
            .reverse()
            .find((candidate) => /^\s*- (inputText|tapOn|hideKeyboard)/.test(candidate));
          assert.ok(
            before !== undefined && /inputText/.test(before),
            `${flow}:${String(index + 1)} hideKeyboard without a typed text right before`,
          );
        }
        // a quoted sentence ends with an escaped dot / question mark (a regex over the whole node)
        const quoted = /^\s*(?:- )?(?:visible|notVisible|text|element|tapOn|assertVisible|assertNotVisible):\s*'(.*)'\s*$/.exec(line)?.[1];
        if (quoted !== undefined) {
          assert.doesNotMatch(
            quoted,
            /[\p{L}\p{N}][.?]$/u,
            `${flow}:${String(index + 1)} unescaped final dot or question mark in ${quoted}`,
          );
        }
      });
      // `id` and `text` in one step: the lines after an `id:` of the same map are never a `text:` (they go in separate steps)... except the
      // established form `visible: { id, text }` of the earlier flows, which reads one node; none of the survey flows uses a bare tapOn with both
      assert.doesNotMatch(text, /tapOn:\r?\n(?: {4}.*\r?\n)*? {4}id: .*\r?\n {4}text:/, flow);
    }
  });

  it('EVM-137 W5: the words the flows type are the ones the log check looks for, and nowhere else in the flows are an e-mail or an 11-digit number', () => {
    const create = flowText('common/survey-create.yaml');
    for (const word of ['Piaseczno', 'Fikcyjna', '05-500', '600000011']) assert.ok(create.includes(`inputText: '${word}'`), word);
    for (const flow of surveyFlows) assert.doesNotMatch(flowText(flow), /@|\b\d{11}\b/, flow);
  });

  it('EVM-137 AC2: no flow talks to anything but the scenario server (no URL in the flows)', () => {
    for (const flow of [...surveyFlows, ...COMMON]) assert.doesNotMatch(flowText(flow), /https?:\/\//, flow);
  });
});
