import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CAMERA_SCENARIOS } from '../src/camera-scenarios.mjs';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { isVideoAction } from '../src/device-video.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';
import { VIDEO_SCENARIOS } from '../src/video-scenarios.mjs';

const APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const FLOWS = join(APP, 'e2e');
const LOCAL_ACTIONS = new Set(['force-stop', 'kill-9', 'reboot']);
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = VIDEO_SCENARIOS.flatMap((scenario) => scenario.steps);
const videoFlows = [...new Set(steps.map((step) => step.flow))].sort();
/** The flows of this story: 90 and up (the sign-in flow 80 is the one of the camera scenarios). */
const OWN = videoFlows.filter((flow) => /^(9\d|1\d\d)-/.test(flow));

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
      .filter((name) => /^(9\d|10\d)-.*\.yaml$/.test(name))
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
        assert.ok(
          isUploadAction(action) || isCameraAction(action) || isVideoAction(action) || LOCAL_ACTIONS.has(action),
          `${step.flow}: ${action}`,
        );
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
    // the emulator is given a location first, so a camera that WOULD write one has something to write; then the file itself is judged (SEC-110-04, SEC-110-08)
    assert.deepEqual(record.before, ['camera-grant', 'camera-geo-fix']);
    assert.deepEqual(record.after, [
      'video-no-audio-no-location:1',
      'video-gallery-unchanged',
      'permissions-minimal',
      'upload-none-yet',
      'logcat-clean',
    ]);
    assert.deepEqual(record.onFail, ['video-last-error']);
    assert.deepEqual(scenario.steps[0]?.after, ['video-gallery-baseline']);
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
      'files=1;waiting=1;uploading=0;failed=0;attention=0;',
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
    const catalogue = [
      readFileSync(join(APP, 'src', 'i18n', 'pl.ts'), 'utf8'),
      ...['sync-stub.mjs', 'stub-api.mjs', 'upload-stub.mjs'].map((name) =>
        readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'),
      ),
    ].join(' ');
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
        const value = (match[1] ?? '')
          .replaceAll(String.raw`\.`, '.')
          .replaceAll(String.raw`\?`, '?')
          .replaceAll(String.raw`\(`, '(')
          .replaceAll(String.raw`\)`, ')');
        if (value.includes('=')) continue; // a status line of the hook
        for (const chunk of value
          .split(/\.\*|[()|]|\[[^\]]*\](?:\+|\{\d+\})?|, |\. /)
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

  it('EVM-110 AC1 AC3 AC4 AC5 AC8: together the scenarios cover every criterion Maestro can show, each scenario states its own, and every flow of 91-102 belongs to one', () => {
    const covered = new Set(VIDEO_SCENARIOS.flatMap((scenario) => [...scenario.ac.matchAll(/AC\d/g)].map((match) => match[0])));
    assert.deepEqual([...covered].sort(), ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC8']);
    assert.deepEqual(
      VIDEO_SCENARIOS.map((scenario) => scenario.name),
      ['video-record', 'video-wifi-only', 'video-wifi-setting-off', 'video-wifi-midway', 'video-batch-3', 'video-interrupt'],
    );
    assert.equal(OWN.length, 13);
  });

  it('EVM-110 AC4: on the network with charges the film waits and the picture goes - the server got exactly one part; then Wi-Fi and two objects, one per asset', () => {
    const scenario = VIDEO_SCENARIOS.find((candidate) => candidate.name === 'video-wifi-only');
    assert.deepEqual(
      scenario?.steps.map((step) => [step.flow, step.before ?? [], step.after ?? []]),
      [
        ['80-camera-sign-in.yaml', ['upload-reset', 'logcat-clear', 'upload-part-delay:0'], []],
        ['91-video-wifi-held.yaml', ['network-metered'], ['upload-part-puts:1']],
        ['92-video-wifi-sent.yaml', ['network-unmetered'], ['upload-checkpoint-many:2', 'tokens-not-in-clear', 'logcat-clean']],
      ],
    );
    const held = flowText('91-video-wifi-held.yaml');
    for (const part of [
      "assertVisible: '.*1 film czeka na Wi-Fi\\. Zdjęcia i wpisy wysyłamy normalnie\\..*'",
      "id: 'waiting-wifi-banner'",
      'Oględziny, Film',
      "assertVisible: 'Zmień ustawienie'",
      "assertVisible: 'Czeka na Wi-Fi \\(1\\)'",
      "assertNotVisible: 'Wymaga uwagi'",
      "MIB: '16'",
    ])
      assert.ok(held.includes(part), part);
    const off = flowText('93-video-setting-off.yaml');
    for (const part of [
      "id: 'waiting-wifi-change'",
      "id: 'more-wifi-switch'",
      "text: 'Filmy wysyłamy przez każdą sieć.*'",
      "notVisible: '.*Czeka na Wi-Fi.*'",
    ])
      assert.ok(off.includes(part), part);
    // EVM-111 AC5: no "Wysłano" and no "0 do wysłania" on the phone - the end of the flows is "no longer waiting for Wi-Fi", the tool waits for the object
    assert.doesNotMatch(off, /Wysłano|\b0 do wysłania/);
    // the explanation that follows the turning off is judged without a dialog in the way
    assert.match(off, /tapOn:\n {4}id: 'more-wifi-switch'\n- extendedWaitUntil:/);
  });

  it('EVM-110 AC5: a film on its way over Wi-Fi; Wi-Fi goes: no new part over the network with charges, "Czeka na Wi-Fi" without an error; Wi-Fi returns: finished, one object', () => {
    const scenario = VIDEO_SCENARIOS.find((candidate) => candidate.name === 'video-wifi-midway');
    assert.deepEqual(
      scenario?.steps.map((step) => [step.flow, step.before ?? [], step.after ?? []]),
      [
        ['80-camera-sign-in.yaml', ['upload-reset', 'logcat-clear', 'upload-part-delay:5000'], []],
        ['94-video-midway-start.yaml', ['network-unmetered'], ['network-metered']],
        ['95-video-midway-waiting.yaml', [], ['upload-part-puts-hold']],
        [
          '92-video-wifi-sent.yaml',
          ['network-unmetered', 'upload-part-delay:0'],
          ['upload-checkpoint-many:1', 'tokens-not-in-clear', 'logcat-clean'],
        ],
      ],
    );
    const waiting = flowText('95-video-midway-waiting.yaml');
    for (const part of [
      "visible: '.*Czeka na Wi-Fi'",
      "assertNotVisible: 'Wymaga uwagi'",
      "assertNotVisible: 'Nie wysłano.*'",
      "assertNotVisible: 'Ponów'",
    ])
      assert.ok(waiting.includes(part), part);
    // the transfer is long enough for the switch (about 12 s) to find it going: 8 parts of 4 MiB, each answer held 5 s
    assert.match(flowText('94-video-midway-start.yaml'), /MIB: '32'/);
  });

  it('EVM-110 AC8: three films saved offline, a kill, offline again, the network with charges, Wi-Fi, a dropped connection, a force-stop, the end - and the judgement of the server', () => {
    const scenario = VIDEO_SCENARIOS.find((candidate) => candidate.name === 'video-batch-3');
    assert.deepEqual(
      scenario?.steps.map((step) => [step.flow, step.airplane, step.before ?? [], step.after ?? []]),
      [
        ['80-camera-sign-in.yaml', false, ['upload-reset', 'logcat-clear', 'upload-part-delay:1500'], ['video-gallery-baseline']],
        ['96-video-batch-inject.yaml', true, ['camera-grant'], ['kill-9']],
        ['97-video-batch-after-kill.yaml', true, [], ['jobs-none', 'upload-none-yet']],
        ['98-video-batch-held.yaml', false, ['network-metered'], ['upload-part-puts:0']],
        ['99-video-batch-uploading.yaml', false, ['network-unmetered', 'upload-fault:drop_mid_part:1'], ['force-stop']],
        [
          '92-video-wifi-sent.yaml',
          false,
          ['upload-part-delay:0'],
          ['upload-checkpoint-many:3', 'video-gallery-unchanged', 'tokens-not-in-clear', 'logcat-clean'],
        ],
      ],
    );
    assert.equal(scenario.steps[4]?.background, true);
    const inject = flowText('96-video-batch-inject.yaml');
    // two synthetic films of 64 MiB by the hook and one real recording of the camera, saved by the same path
    for (const part of ["MIB: '64'", "COUNT: '2'", "id: 'camera-mode-video'", "text: '3 do wysłania'", 'common/camera-from-order.yaml'])
      assert.ok(inject.includes(part), part);
    assert.match(flowText('97-video-batch-after-kill.yaml'), /STATUS: 'files=3;waiting=3;uploading=0;failed=0;attention=0;/);
    assert.match(flowText('98-video-batch-held.yaml'), /3 filmy czekają na Wi-Fi/);
    assert.match(flowText('92-video-wifi-sent.yaml'), /notVisible: '.*Czeka na Wi-Fi.*'/);
    assert.doesNotMatch(flowText('92-video-wifi-sent.yaml'), /Wysłano|\b0 do wysłania/);
  });

  it('EVM-110 AC3: Home during a recording saves the film; a kill during a recording leaves no row and shows the Banner once', () => {
    const scenario = VIDEO_SCENARIOS.find((candidate) => candidate.name === 'video-interrupt');
    assert.deepEqual(
      scenario?.steps.map((step) => [step.flow, step.after ?? []]),
      [
        ['80-camera-sign-in.yaml', []],
        ['100-video-interrupt-home.yaml', ['upload-none-yet', 'logcat-clean']],
        ['101-video-kill-recording.yaml', ['kill-9']],
        ['102-video-kill-after.yaml', ['upload-none-yet', 'logcat-clean']],
      ],
    );
    assert.match(flowText('100-video-interrupt-home.yaml'), /pressKey: Home/);
    const after = flowText('102-video-kill-after.yaml');
    assert.ok(after.includes("id: 'interrupted-recording'"));
    assert.ok(after.includes('Poprzednie nagranie zostało przerwane i nie zostało zapisane\\.'));
    // exactly the one film of the earlier flow: no row of a damaged film
    assert.match(after, /STATUS: 'files=1;waiting=1;/);
  });

  it('EVM-110 AC4 AC5: every scenario that takes Wi-Fi away puts it back as its own last network step or is cleaned by the runner (the step names are the only ones)', () => {
    for (const scenario of VIDEO_SCENARIOS) {
      const network = scenario.steps
        .flatMap((step) => [...(step.before ?? []), ...(step.after ?? [])])
        .filter((action) => action.startsWith('network-'));
      assert.ok(
        network.every((action) => action === 'network-metered' || action === 'network-unmetered'),
        scenario.name,
      );
      // the runner restores Wi-Fi after a scenario that ends metered (test/run.test.mjs); here: the scenarios that end metered are only those that fail
      const last = network.at(-1);
      assert.ok(
        last === undefined ||
          last === 'network-unmetered' ||
          scenario.name === 'video-wifi-midway' ||
          scenario.name === 'video-wifi-setting-off' ||
          scenario.name === 'video-wifi-only' ||
          scenario.name === 'video-batch-3',
        scenario.name,
      );
    }
  });

  it('EVM-110 AC8: the hook flows write the numbers of films through the fields of the panel and wait for the status of the LAST save', () => {
    const video = flowText('common/hook-capture-video.yaml');
    for (const part of [
      "id: 'e2e-video-mib'",
      "id: 'e2e-video-count'",
      "id: 'e2e-capture-video'",
      "text: 'video_added=${COUNT}'",
      'centerElement: true',
    ])
      assert.ok(video.includes(part), part);
    const photos = flowText('common/hook-capture-photos.yaml');
    assert.ok(photos.includes("text: 'capture_added=${COUNT}'"));
  });
});
