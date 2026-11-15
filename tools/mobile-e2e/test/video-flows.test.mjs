import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CAMERA_SCENARIOS } from '../src/camera-scenarios.mjs';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';
import { VIDEO_SCENARIOS } from '../src/video-scenarios.mjs';

const APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const FLOWS = join(APP, 'e2e');
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = VIDEO_SCENARIOS.flatMap((scenario) => scenario.steps);
const videoFlows = [...new Set(steps.map((step) => step.flow))].sort();
/** The flows of this story: 90 and up (the sign-in flow 80 is the one of the camera scenarios). */
const OWN = videoFlows.filter((flow) => /^9\d-/.test(flow));

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('Maestro flows 90-9x and the video scenarios agree (EVM-110)', () => {
  it('EVM-110 AC1: every flow of a video scenario exists, belongs to the application id and the flows 9x are exactly the files 9x-*.yaml (none left out)', () => {
    for (const flow of videoFlows)
      assert.match(flowText(flow), new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
    const files = readdirSync(FLOWS)
      .filter((name) => /^9\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(OWN, files);
    for (const flow of OWN) {
      const claimed = /^# EVM-110 (AC\d(?: AC\d)*)/m.exec(flowText(flow))?.[1];
      assert.ok(claimed !== undefined, `${flow}: no "# EVM-110 AC<n>" header`);
      const stated = VIDEO_SCENARIOS.filter((scenario) => scenario.steps.some((step) => step.flow === flow))
        .map((scenario) => scenario.ac)
        .join(' ');
      for (const ac of claimed.split(' ')) assert.match(stated, new RegExp(String.raw`\b${ac}\b`), `${flow} claims ${ac}`);
    }
  });

  it('EVM-110 AC1: the video scenarios are outside the default run, start with the sign-in of the camera, reset the server and use known steps only', () => {
    const names = VIDEO_SCENARIOS.map((scenario) => scenario.name);
    assert.equal(new Set(names).size, names.length);
    for (const scenario of VIDEO_SCENARIOS) {
      assert.ok(scenario.name.startsWith('video-'), scenario.name);
      const first = /** @type {NonNullable<(typeof scenario.steps)[number]>} */ (scenario.steps[0]);
      assert.equal(first.flow, '80-camera-sign-in.yaml', scenario.name);
      assert.equal(first.airplane, false, scenario.name);
      assert.equal(first.before?.[0], 'upload-reset', scenario.name);
      for (const step of scenario.steps) assert.equal(step.upload, true, `${scenario.name} ${step.flow}`);
    }
    for (const step of steps)
      for (const action of [...(step.before ?? []), ...(step.after ?? [])])
        assert.ok(isUploadAction(action) || isCameraAction(action), `${step.flow}: ${action}`);
    assert.equal(
      SCENARIOS.some((scenario) => scenario.name.startsWith('video-')),
      false,
    );
    assert.deepEqual(
      selectScenarios(['video-']).map((scenario) => scenario.name),
      names,
    );
    // `--only camera-` and `--only upload-` do not pull the video scenarios in
    for (const word of ['camera-', 'upload-'])
      assert.equal(
        selectScenarios([word]).some((scenario) => scenario.name.startsWith('video-')),
        false,
      );
    const others = new Set(
      [...SCENARIOS, ...UPLOAD_SCENARIOS, ...CAMERA_SCENARIOS].flatMap((scenario) => scenario.steps.map((step) => step.flow)),
    );
    for (const flow of OWN) assert.equal(others.has(flow), false, flow);
  });

  it('EVM-110 AC1 AC2: the smoke flow records without a network with the camera granted, and judges nothing but the record, the save and the row in the Queue', () => {
    const scenario = VIDEO_SCENARIOS.find((candidate) => candidate.name === 'video-record');
    assert.ok(scenario);
    const record = scenario.steps[1];
    assert.equal(record?.flow, '90-video-record.yaml');
    assert.equal(record.airplane, true);
    assert.deepEqual(record.before, ['camera-grant']);
    assert.ok(record.after?.includes('permissions-minimal') && record.after.includes('upload-none-yet'));
    const text = flowText('90-video-record.yaml');
    for (const part of [
      "id: 'camera-mode-video'",
      'Film bez dźwięku',
      'Wybierz kategorię przed nagraniem\\.',
      "id: 'camera-timer'",
      "text: '0:(0[5-9]|[1-5][0-9]) / 5:00'",
      'Zapisano film w telefonie',
      "text: '1 film'",
      "text: '1 do wysłania'",
      'W trakcie prac, Film · 0:[0-9]{2} · [0-9]+ MB, .*, Oczekuje',
      'files=1;waiting=1;uploading=0;sent=0;failed=0;attention=0;',
    ])
      assert.ok(text.includes(part), part);
    // below the fold and under the bar: scrolled to with the element centred
    assert.match(text, /scrollUntilVisible:\n {4}element: 'W trakcie prac, Film[^\n]*\n {4}direction: DOWN\n {4}centerElement: true/);
  });

  it('EVM-110 AC1: no flow uses a coordinate, a hideKeyboard without typing before it, or a fixed sleep', () => {
    for (const flow of OWN) {
      const text = flowText(flow);
      assert.doesNotMatch(text, /\bpoint:|^- tapOn: \d/m, flow);
      for (const match of text.matchAll(/^- hideKeyboard$/gm)) {
        const before = text.slice(0, match.index).trimEnd().split('\n').at(-1) ?? '';
        assert.match(before, /^- inputText:/, `${flow}: hideKeyboard without typing before it`);
      }
      assert.doesNotMatch(text, /^- (?:sleep|wait)/m, `${flow}: the time of the film is waited for with the counter, not with a sleep`);
    }
  });

  it('EVM-110 AC1: every id and text a video flow looks for exists in the app (ids in the sources, texts in the Polish catalogue)', () => {
    const code = sources(join(APP, 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const catalogue = readFileSync(join(APP, 'src', 'i18n', 'pl.ts'), 'utf8');
    const templates = [...code.matchAll(/`([a-z0-9-]+-)\$\{/g)].map((match) => match[1] ?? '');
    for (const flow of [...OWN, 'common/camera-from-order.yaml', 'common/media-status.yaml']) {
      const text = flowText(flow);
      for (const match of text.matchAll(/^\s+id: '([^']+)'/gm)) {
        const id = match[1] ?? '';
        const known = code.includes(`'${id}'`) || code.includes(`"${id}"`) || templates.some((prefix) => id.startsWith(prefix));
        assert.ok(known, `${flow}: id ${id} is in no screen of the app`);
      }
      const texts = [...text.matchAll(/^(?:- )?(?:assertVisible|visible|element): '([^']+)'/gm), ...text.matchAll(/^\s+text: '([^']+)'/gm)];
      for (const match of texts) {
        const value = (match[1] ?? '').replaceAll(String.raw`\.`, '.').replaceAll(String.raw`\?`, '?');
        if (value.includes('=')) continue; // a status line of the hook
        for (const chunk of value
          .split(/\.\*|[()|]|\[[^\]]*\](?:\+|\{\d+\})?|, /)
          .filter((part) => /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{5}/.test(part))) {
          const needle = chunk
            .trim()
            .replace(/^\d+ /, '')
            .replace(/ ·$/, '')
            .replace(/^· /, '')
            .replace(/^ZL-E2E-\d$/, 'ZL-E2E-');
          assert.ok(catalogue.includes(needle) || code.includes(needle), `${flow}: the text "${chunk}" is nowhere in the app`);
        }
      }
    }
  });
});
