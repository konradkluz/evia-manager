import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isCameraAction } from '../src/device-camera.mjs';
import { isPhotosAction } from '../src/device-photos.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { CAMERA_SCENARIOS } from '../src/camera-scenarios.mjs';
import { LOCK_SCENARIOS } from '../src/lock-scenarios.mjs';
import { ORDER_FILES_SCENARIOS } from '../src/order-files-scenarios.mjs';
import { PHOTOS_SCENARIOS } from '../src/photos-scenarios.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { SURVEY_SCENARIOS } from '../src/survey-scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';
import { VIDEO_SCENARIOS } from '../src/video-scenarios.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FLOWS = join(ROOT, 'apps', 'mobile', 'e2e');
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = PHOTOS_SCENARIOS.flatMap((scenario) => scenario.steps);
const OWN = [...new Set(steps.map((step) => step.flow))].filter((flow) => /^14\d-/.test(flow)).sort();
const scenarioOf = (/** @type {string} */ name) => {
  const found = PHOTOS_SCENARIOS.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, name);
  return found;
};
/** @param {import('../src/scenarios.mjs').Scenario} of @param {number} index */
const stepAt = (of, index) => {
  const found = of.steps[index];
  assert.ok(found !== undefined, `step ${String(index)}`);
  return found;
};
const actionsOf = (/** @type {import('../src/scenarios.mjs').Step} */ step) => [...(step.before ?? []), ...(step.after ?? [])];

describe('Maestro flows 140-143 and the photos scenarios agree (EVM-142)', () => {
  it('EVM-142 AC2: the flows 14x are exactly the flows of the scenarios (none left out, none shared with another family), each with the application id and a header that names its criteria', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^14\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(OWN, files);
    for (const flow of [...OWN, 'common/photos-details.yaml', 'common/photos-grid-open.yaml']) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      assert.match(text, /^# EVM-142 AC\d/m, flow);
    }
    const claimed = PHOTOS_SCENARIOS.map((scenario) => scenario.ac).join(' ');
    for (const flow of OWN)
      for (const ac of (/^# EVM-142 (AC\d(?: AC\d)*)/m.exec(flowText(flow))?.[1] ?? '').split(' '))
        assert.match(claimed, new RegExp(String.raw`\b${ac}\b`), flow);
    const others = new Set(
      [
        ...SCENARIOS,
        ...UPLOAD_SCENARIOS,
        ...CAMERA_SCENARIOS,
        ...VIDEO_SCENARIOS,
        ...SURVEY_SCENARIOS,
        ...ORDER_FILES_SCENARIOS,
        ...LOCK_SCENARIOS,
      ].flatMap((scenario) => scenario.steps.map((step) => step.flow)),
    );
    for (const flow of OWN) assert.equal(others.has(flow), false, flow);
  });

  it('EVM-142: the scenarios are outside the default run, run with `--only photos-`, and no other prefix pulls them in', () => {
    assert.deepEqual(
      PHOTOS_SCENARIOS.map((scenario) => scenario.name),
      ['photos-grid', 'photos-preview', 'photos-offline', 'photos-no-trace'],
    );
    for (const name of PHOTOS_SCENARIOS.map((scenario) => scenario.name))
      assert.equal(
        SCENARIOS.some((candidate) => candidate.name === name),
        false,
      );
    assert.deepEqual(
      selectScenarios(['photos-']).map((candidate) => candidate.name),
      PHOTOS_SCENARIOS.map((scenario) => scenario.name),
    );
    for (const word of ['camera-', 'upload-', 'video-', 'survey-', 'order-files', 'lock-'])
      assert.equal(
        selectScenarios([word]).some((candidate) => candidate.name.startsWith('photos-')),
        false,
        word,
      );
  });

  it('EVM-142: every step is served by the upload part (the sign-in), carries the photos in the replica and uses only known steps of the device tools; every scenario starts with a fresh sign-in and resets the photos part', () => {
    for (const step of steps) {
      assert.equal(step.upload, true, step.flow);
      assert.equal(step.photos, 'on', step.flow);
      assert.equal(step.server, 'ok', step.flow);
      for (const action of actionsOf(step))
        assert.ok(isPhotosAction(action) || isUploadAction(action) || isCameraAction(action), `${step.flow}: ${action}`);
    }
    for (const scenario of PHOTOS_SCENARIOS) {
      assert.equal(stepAt(scenario, 0).flow, '80-camera-sign-in.yaml', scenario.name);
      assert.deepEqual(stepAt(scenario, 0).before, ['upload-reset', 'photos-reset'], scenario.name);
    }
  });

  it('EVM-142 AC2 AC6: the grid is judged by the requests of the server - three thumbnails, none for the two files that are not ready, no preview, no original - and by the headers', () => {
    const grid = scenarioOf('photos-grid');
    assert.deepEqual(
      grid.steps.map((step) => step.flow),
      ['80-camera-sign-in.yaml', '140-photos-grid.yaml', '140-photos-grid-after.yaml'],
    );
    assert.deepEqual(stepAt(grid, 1).after, [
      'photos-requests:thumbnailUrls=3,thumbnailImages=3,previewUrls=0,previewImages=0,originalUrls=0,unreadyUrls=0',
      'photos-headers',
    ]);
    const text = flowText('140-photos-grid.yaml');
    for (const part of [
      "text: '5 zdjęć'",
      'Po zakończeniu, ',
      'W trakcie prac, ',
      'Stan przed pracami, ',
      'Przygotowujemy podgląd',
      'Plik zatrzymany do sprawdzenia',
      "childOf:\n      id: 'order-photos'",
    ])
      assert.ok(text.includes(part), part);
    assert.match(text, /assertNotVisible: '\.\*\\\.\(jpg\|jpeg\|png\|webp\)\.\*'/);
  });

  it('EVM-142 AC3: the preview scenario - an expired address is renewed ONCE (2 addresses, 2 requests), a 500 asks for no second address, the retry asks for a NEW one, a 429 of the address is retried after the Retry-After', () => {
    const preview = scenarioOf('photos-preview');
    assert.deepEqual(
      preview.steps.map((step) => step.flow),
      [
        '80-camera-sign-in.yaml',
        '141-photos-preview-open.yaml',
        '141-photos-preview-shown.yaml',
        '141-photos-preview-error.yaml',
        '141-photos-preview-retry.yaml',
        '141-photos-preview-limit.yaml',
        '141-photos-preview-limit-retry.yaml',
      ],
    );
    assert.deepEqual(stepAt(preview, 1).before, ['photos-fault:image:403:1:preview']);
    assert.equal(stepAt(preview, 1).after?.[0], 'photos-requests:previewUrls=2,previewImages=2,failedImages=1');
    assert.deepEqual(stepAt(preview, 3).before, ['photos-fault:image:500:0:preview']);
    assert.deepEqual(stepAt(preview, 3).after, ['photos-requests:previewUrls=3,previewImages=3,failedImages=2']);
    assert.deepEqual(stepAt(preview, 4).before, ['photos-fault-clear']);
    assert.deepEqual(stepAt(preview, 5).before, ['photos-fault:url:429:1:preview']);
    assert.deepEqual(stepAt(preview, 6).before, ['photos-wait:7000']);
    assert.ok(stepAt(preview, 6).after?.includes('photos-headers'));
    const text = flowText('141-photos-preview-open.yaml') + flowText('141-photos-preview-error.yaml');
    for (const part of [
      "id: 'photo-preview'",
      'Opis testowy completed_work',
      "id: 'photo-preview-close'",
      'Nie udało się wczytać zdjęcia',
      'Spróbuj ponownie',
    ])
      assert.ok(text.includes(part), part);
  });

  it('EVM-142 AC4: offline - no request leaves the phone; back online - the thumbnails come by themselves', () => {
    const offline = scenarioOf('photos-offline');
    assert.deepEqual(
      offline.steps.map((step) => [step.flow, step.airplane]),
      [
        ['80-camera-sign-in.yaml', false],
        ['142-photos-offline.yaml', true],
        ['142-photos-online.yaml', false],
      ],
    );
    assert.deepEqual(stepAt(offline, 1).after, ['photos-requests:thumbnailUrls=0,previewUrls=0,thumbnailImages=0,previewImages=0']);
    assert.ok((stepAt(offline, 2).after ?? []).join(' ').includes('photos-requests:thumbnailUrls>=3,thumbnailImages>=3'));
    assert.ok(flowText('142-photos-offline.yaml').includes("assertVisible: 'Podgląd zdjęć wymaga internetu'"));
    assert.ok(flowText('142-photos-online.yaml').includes("notVisible: 'Podgląd zdjęć wymaga internetu'"));
  });

  it('EVM-142 AC5: the proof of "nothing stays on the phone" has a baseline first, a search after every stage, the lock with the download in progress, the sign-out, the wipe, and the POSITIVE CONTROL last on the same install', () => {
    const proof = scenarioOf('photos-no-trace');
    assert.deepEqual(
      proof.steps.map((step) => step.flow),
      [
        '80-camera-sign-in.yaml',
        '143-photos-view.yaml',
        '143-photos-view-close.yaml',
        '143-photos-view-error.yaml',
        '143-photos-lock-open.yaml',
        '143-photos-lock.yaml',
        '143-photos-logout.yaml',
        '143-photos-wipe.yaml',
        '143-photos-control.yaml',
      ],
    );
    assert.deepEqual(stepAt(proof, 0).after, ['photos-disk-baseline', 'gallery-baseline']);
    // every stage where a picture or an address could be on the phone is searched (disk) and read (log)
    for (const index of [1, 2, 3, 5, 6, 7]) {
      const after = stepAt(proof, index).after ?? [];
      assert.ok(after.includes('photos-disk-check'), `step ${String(index)} disk`);
      assert.ok(after.includes('photos-logcat-clean'), `step ${String(index)} log`);
    }
    // the first stage: the expired address was renewed once
    assert.deepEqual(stepAt(proof, 1).before, ['photos-fault:image:403:1:preview']);
    assert.ok((stepAt(proof, 1).after ?? []).join(' ').includes('previewUrls=2,previewImages=2,failedImages=1'));
    // the failed load
    assert.deepEqual(stepAt(proof, 3).before, ['photos-fault:image:500:0:preview']);
    // the lock: the download is held, the tree is read unlocked (control) and locked, the server counts the abandoned request
    assert.deepEqual(stepAt(proof, 4).before, ['photos-fault-clear', 'photos-delay:100000']);
    assert.deepEqual(stepAt(proof, 4).after, ['photos-view-tree-unlocked']);
    assert.ok(stepAt(proof, 5).after?.includes('photos-view-tree-locked'));
    assert.ok(stepAt(proof, 5).after?.includes('photos-requests:abandoned>=1'));
    // the delay is off again before the cold start; the gallery is unchanged at the end of the stages
    assert.deepEqual(stepAt(proof, 6).before, ['photos-delay:0']);
    assert.ok(stepAt(proof, 7).after?.includes('gallery-unchanged'));
    // the positive control is the LAST step: after every negative check, on the same install
    assert.deepEqual(proof.steps.at(-1)?.after, ['photos-control-check']);
    for (const step of proof.steps.slice(0, -1)) assert.equal(actionsOf(step).includes('photos-control-check'), false, step.flow);
  });

  it('EVM-142 AC5: the control flow uses the hook of the e2e variant and waits for the status it writes (the size of the control picture, 48 bytes)', () => {
    const text = flowText('143-photos-control.yaml');
    assert.ok(text.includes("id: 'e2e-cache-control'"));
    assert.ok(text.includes("text: 'control_status=200;control_bytes=48'"));
    assert.ok(text.includes("id: 'evia-e2e-hooks-panel'"));
  });

  it('EVM-142 AC5: the lock flow sets the unlock held and the clock 6 minutes ahead, returns to the cover and asserts the screens of the photos are gone', () => {
    const text = flowText('143-photos-lock.yaml');
    for (const part of [
      "id: 'e2e-unlock-hold'",
      "id: 'e2e-background-6'",
      'pressKey: home',
      "id: 'lock-overlay'",
      "id: 'photo-preview'",
      "id: 'order-photos-grid'",
    ])
      assert.ok(text.includes(part), part);
  });

  it('EVM-142: the flows are judged without a coordinate and name no file, and the texts they wait for are the words of the app (apps/mobile/src/i18n/pl.ts)', () => {
    const words = readFileSync(join(ROOT, 'apps', 'mobile', 'src', 'i18n', 'pl.ts'), 'utf8');
    for (const flow of [...OWN, 'common/photos-details.yaml', 'common/photos-grid-open.yaml'])
      assert.doesNotMatch(flowText(flow), /\bpoint:|^- tapOn: \d/m, flow);
    for (const word of [
      'Podgląd zdjęć wymaga internetu',
      'Przygotowujemy podgląd',
      'Plik zatrzymany do sprawdzenia',
      'Nie udało się wczytać zdjęcia',
      'Spróbuj ponownie',
      'Nie udało się wczytać części zdjęć.',
      'Zdjęcia zlecenia',
      'Stan przed pracami',
      'W trakcie prac',
      'Po zakończeniu',
      'Usterka / problem',
    ])
      assert.ok(words.includes(`'${word}'`) || words.includes(word), word);
    // the order of the photos of the replica (the flows address the tiles by position)
    const text = flowText('143-photos-view-error.yaml') + flowText('141-photos-preview-limit.yaml');
    assert.ok(text.includes("id: 'photo-tile-1'") && text.includes("id: 'photo-tile-2'"));
  });
});
