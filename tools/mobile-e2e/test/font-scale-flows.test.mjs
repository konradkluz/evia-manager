import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isDisplayAction, parseDisplayAction } from '../src/device-display.mjs';
import { isPhotosAction } from '../src/device-photos.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { FONT_SCALE_SCENARIOS } from '../src/font-scale-scenarios.mjs';
import { selectScenarios } from '../src/upload-scenarios.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FLOWS = join(ROOT, 'apps', 'mobile', 'e2e');
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = FONT_SCALE_SCENARIOS.flatMap((scenario) => scenario.steps);
const actionsOf = (/** @type {import('../src/scenarios.mjs').Step} */ step) => [
  ...(step.before ?? []),
  ...(step.after ?? []),
  ...(step.onFail ?? []),
];
const scenarioOf = (/** @type {string} */ name) => {
  const found = FONT_SCALE_SCENARIOS.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, name);
  return found;
};

describe('Maestro flows 150-154 and the font-scale scenarios agree (EVM-151)', () => {
  it('EVM-151 AC5: the flows 15x are exactly the flows of the scenarios, each with the application id and a header that names its criteria', () => {
    const own = [...new Set(steps.map((step) => step.flow))].filter((flow) => /^15\d-/.test(flow)).sort();
    const files = readdirSync(FLOWS)
      .filter((name) => /^15\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(own, files);
    for (const flow of [...own, 'common/font-scale-tour.yaml']) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      assert.match(text, /^# EVM-151 AC\d/m, flow);
    }
  });

  it('EVM-151 AC5: every step uses known device steps, every `display:` setting is valid, and the display is put back on a failure and after the last step of the tours', () => {
    for (const step of steps) {
      for (const action of actionsOf(step)) {
        assert.ok(isDisplayAction(action) || isPhotosAction(action) || isUploadAction(action), `${step.flow}: ${action}`);
        if (action.startsWith('display:')) assert.notEqual(parseDisplayAction(action), null, action);
      }
      assert.ok((step.onFail ?? []).includes('display-reset'), `${step.flow} resets on a failure`);
    }
    const bars = scenarioOf('font-scale-bars');
    assert.ok(bars.steps.at(-1)?.after?.includes('display-reset'));
    assert.equal(bars.steps[0]?.flow, '80-camera-sign-in.yaml');
    assert.ok(bars.steps[0].before?.includes('display-reset'));
  });

  it('EVM-151 AC1 AC4 AC5: the tours are the scales of the story - 130% and 200% on 411 dp, 200% on 360 dp - and the 100% one on 360 dp', () => {
    const settings = Object.fromEntries(
      steps
        .filter((step) => step.flow.startsWith('15') && step.flow !== '154-font-scale-sign-in.yaml')
        .map((step) => [step.flow, step.before?.find((action) => action.startsWith('display:'))]),
    );
    assert.deepEqual(settings, {
      '150-font-scale-130.yaml': 'display:font=1.3',
      '151-font-scale-200.yaml': 'display:font=2',
      '152-font-scale-200-narrow.yaml': 'display:font=2,dp=360',
      '153-font-scale-100-narrow.yaml': 'display:font=1,dp=360',
    });
  });

  it('EVM-151 AC5: the tour opens every screen with the app bar that can be opened and takes a screenshot of each', () => {
    const tour = flowText('common/font-scale-tour.yaml');
    for (const id of [
      'nav-orders',
      'order-detail-back',
      'order-photos-back',
      'order-files-back',
      'entry-form',
      'camera-close',
      'quick-order',
      'site-survey',
      'nav-queue',
      'nav-more',
      'privacy-help-back',
      'sync-indicator',
    ])
      assert.match(tour, new RegExp(`id: '${id}'`), id);
    const shots = [...tour.matchAll(/^- takeScreenshot: \$\{CFG\}-(\d+)-([a-z-]+)$/gm)].map((match) => `${match[1]}-${match[2]}`);
    assert.deepEqual(shots, [
      '1-orders',
      '2-order-detail',
      '3-order-photos',
      '4-order-files',
      '5-entry-form',
      '6-camera',
      '7-quick-order',
      '8-site-survey',
      '9-queue',
      '10-more',
      '11-privacy',
    ]);
    assert.match(tour, /assertVisible: 'Zdjęcia zlecenia'/);
  });

  it('EVM-151 AC5: the sign-in at 200% on 360 dp is a separate, cheap step that starts from a fresh install', () => {
    const scenario = scenarioOf('font-scale-sign-in');
    assert.equal(scenario.steps.length, 1);
    assert.ok(scenario.steps[0]?.before?.includes('display:font=2,dp=360'));
    const text = flowText('154-font-scale-sign-in.yaml');
    assert.match(text, /clearState: true/);
    assert.match(text, /runFlow: common\/sign-in\.yaml/);
  });

  it('EVM-151 AC5: `--only font-scale` selects both scenarios and the default run does not', () => {
    assert.deepEqual(
      selectScenarios(['font-scale'])
        .filter((scenario) => scenario.name.startsWith('font-scale'))
        .map((scenario) => scenario.name),
      ['font-scale-bars', 'font-scale-sign-in'],
    );
    assert.equal(
      selectScenarios(null).some((scenario) => scenario.name.startsWith('font-scale')),
      false,
    );
  });
});
