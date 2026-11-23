import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isDisplayAction } from '../src/device-display.mjs';
import { isFilmAction } from '../src/device-film.mjs';
import { isPhotosAction } from '../src/device-photos.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { FILM_SCENARIOS } from '../src/film-scenarios.mjs';
import { selectScenarios } from '../src/upload-scenarios.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FLOWS = join(ROOT, 'apps', 'mobile', 'e2e');
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = FILM_SCENARIOS.flatMap((scenario) => scenario.steps);
const OWN = [...new Set(steps.map((step) => step.flow))].filter((flow) => /^16\d-/.test(flow)).sort();
const scenarioOf = (/** @type {string} */ name) => {
  const found = FILM_SCENARIOS.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, name);
  return found;
};
const actionsOf = (/** @type {import('../src/scenarios.mjs').Step} */ step) => [
  ...(step.before ?? []),
  ...(step.after ?? []),
  ...(step.onFail ?? []),
];

describe('Maestro flows 160-165 and the film scenarios agree (EVM-143)', () => {
  it('EVM-143 AC2: the flows 16x are exactly the flows of the scenarios, each with the application id and a header that names its criteria', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^16\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(files, OWN);
    for (const flow of OWN) {
      const text = flowText(flow);
      assert.ok(text.includes(`appId: ${APPLICATION_ID}`), flow);
      assert.match(text, /^# EVM-143 AC\d/, flow);
    }
  });

  it('EVM-143: the scenarios are selected by the prefix film- and run with the film in the replica and the sign-in of the upload part', () => {
    assert.deepEqual(
      selectScenarios(['film-']).map((scenario) => scenario.name),
      ['film-play', 'film-offline', 'film-no-trace', 'film-font-scale'],
    );
    for (const step of steps) {
      assert.equal(step.upload, true);
      assert.equal(step.photos, 'videos');
      assert.equal(step.server, 'ok');
    }
  });

  it('EVM-143: every step of a scenario is a known step of the device or of the scenario server', () => {
    for (const step of steps)
      for (const action of actionsOf(step))
        assert.ok(
          isFilmAction(action) || isPhotosAction(action) || isUploadAction(action) || isCameraAction(action) || isDisplayAction(action),
          action,
        );
  });

  it('EVM-143 AC1 AC2: the grid and play scenario asks for nothing before "Odtwórz", then counts one address and the ranges, and checks the headers', () => {
    const play = scenarioOf('film-play');
    const grid = play.steps.find((step) => step.flow === '160-film-grid.yaml');
    assert.deepEqual(grid?.after, ['film-requests:urls=0,requests=0,bytes=0']);
    const flow = flowText('160-film-play.yaml');
    for (const wanted of [
      "visible: 'Pauza'",
      "visible: 'Odtwórz ponownie'",
      'video-player-action',
      'video-player-close',
      'm08c-film-before-play',
      'm08c-film-ended',
    ])
      assert.ok(flow.includes(wanted), wanted);
    assert.ok(play.steps.some((step) => step.after?.includes('film-headers')));
    assert.ok(play.steps[0]?.after?.includes('film-manifest'));
    assert.ok(play.steps[0]?.after?.includes('permissions-minimal'));
    assert.ok(flowText('160-film-grid.yaml').includes('Film, Po zakończeniu'));
  });

  it('EVM-143 AC3: an expired address is renewed ONCE (two addresses), a 500 says the message and the button, the retry after the fault plays', () => {
    const play = scenarioOf('film-play');
    const expired = play.steps.find((step) => step.flow === '161-film-expired.yaml');
    assert.deepEqual(expired?.before, ['photos-reset', 'film-expire:1']);
    assert.ok(expired.after?.includes('film-requests:urls=2,failed>=1,ok>=1'));
    assert.ok(flowText('161-film-expired.yaml').includes("assertNotVisible: 'Nie udało się odtworzyć filmu'"));
    const error = play.steps.find((step) => step.flow === '162-film-error.yaml');
    assert.ok(error?.before?.includes('photos-fault:video:500:0'));
    const errorFlow = flowText('162-film-error.yaml');
    assert.ok(errorFlow.includes("'Nie udało się odtworzyć filmu'") && errorFlow.includes("'Spróbuj ponownie'"));
    assert.ok(play.steps.find((step) => step.flow === '162-film-retry.yaml')?.before?.includes('photos-fault-clear'));
  });

  it('EVM-143 AC4: offline - the notice, no request; the network back - nothing starts by itself, no request; the manual retry plays', () => {
    const offline = scenarioOf('film-offline');
    assert.equal(offline.steps.find((step) => step.flow === '163-film-offline.yaml')?.airplane, true);
    assert.ok(flowText('163-film-offline.yaml').includes("'Film wymaga internetu'"));
    const back = offline.steps.find((step) => step.flow === '163-film-online.yaml');
    assert.equal(back?.airplane, false);
    assert.deepEqual(back.after, ['film-requests:urls=0,requests=0']);
    assert.ok(flowText('163-film-online.yaml').includes("assertNotVisible: 'Pauza'"));
    assert.ok(offline.steps.find((step) => step.flow === '163-film-online-retry.yaml')?.after?.includes('film-requests:urls=1,ok>=1'));
  });

  it('EVM-143 AC5: the baseline comes first, every stage is followed by the same search and the log filter, the lock runs with the film slow, and the control ends the proof', () => {
    const trace = scenarioOf('film-no-trace');
    assert.ok(trace.steps[0]?.after?.includes('film-disk-baseline'));
    const stages = ['164-film-view.yaml', '164-film-lock.yaml', '164-film-background.yaml', '164-film-logout.yaml', '164-film-wipe.yaml'];
    for (const flow of stages) {
      const found = trace.steps.find((step) => step.flow === flow);
      assert.ok(found?.after?.includes('film-disk-check'), flow);
      assert.ok(found?.after?.includes('photos-logcat-clean'), flow);
    }
    assert.ok(trace.steps.find((step) => step.flow === '164-film-lock-open.yaml')?.before?.includes('film-throttle:250'));
    assert.ok(trace.steps.find((step) => step.flow === '164-film-background.yaml')?.before?.includes('film-throttle:0'));
    assert.ok(trace.steps.at(-1)?.after?.includes('film-disk-control'));
    assert.ok(flowText('164-film-lock.yaml').includes("id: 'lock-overlay'"));
    assert.ok(flowText('164-film-lock.yaml').includes("id: 'video-player'"));
    assert.ok(flowText('164-film-logout.yaml').includes("'Wylogowano'"));
    assert.ok(flowText('164-film-wipe.yaml').includes("id: 'wipe-confirm'"));
  });

  it('EVM-143 AC6: the font scale tour scrolls to the button at 130%, 200% and 200% on 360 dp, and puts the display back', () => {
    const scale = scenarioOf('film-font-scale');
    assert.deepEqual(
      scale.steps.flatMap((step) => step.before ?? []).filter((action) => action.startsWith('display:')),
      ['display:font=1.3', 'display:font=2', 'display:font=2,dp=360'],
    );
    assert.deepEqual(scale.steps.at(-1)?.after, ['display-reset']);
    for (const step of scale.steps) assert.ok(step.onFail?.includes('display-reset'));
    const tour = flowText('common/film-font-scale-tour.yaml');
    assert.ok(tour.includes('scrollUntilVisible') && tour.includes("id: 'video-player-action'"));
    assert.ok(tour.includes("'Zamknij odtwarzacz'"));
    for (const [flow, prefix] of [
      ['165-film-font-scale-130.yaml', 'f130'],
      ['165-film-font-scale-200.yaml', 'f200'],
      ['165-film-font-scale-200-narrow.yaml', 'f200n'],
    ])
      assert.ok(flowText(flow ?? '').includes(`CFG: '${prefix ?? ''}'`), flow ?? '');
  });
});
