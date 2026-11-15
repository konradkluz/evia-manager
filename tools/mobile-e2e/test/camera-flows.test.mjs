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

const APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const FLOWS = join(APP, 'e2e');
const LOCAL_ACTIONS = new Set(['force-stop', 'kill-9', 'reboot']);
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');
const steps = CAMERA_SCENARIOS.flatMap((scenario) => scenario.steps);
const cameraFlows = [...new Set(steps.map((step) => step.flow))].sort();
const COMMON = ['common/camera-from-order.yaml', 'common/media-status.yaml'];

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('Maestro flows 80-89 and the camera scenarios agree (EVM-108)', () => {
  it('EVM-108 AC1: every flow of a camera scenario exists, belongs to the application id and names, in its header, the criteria that the scenarios using it state', () => {
    /** @type {Map<string, string>} */
    const stated = new Map();
    for (const scenario of CAMERA_SCENARIOS)
      for (const step of scenario.steps) stated.set(step.flow, `${stated.get(step.flow) ?? ''} ${scenario.ac}`);
    for (const [flow, acs] of stated) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      const claimed = /^# EVM-108 (AC\d(?: AC\d)*)/m.exec(text)?.[1];
      assert.ok(claimed !== undefined, `${flow}: no "# EVM-108 AC<n>" header`);
      for (const ac of claimed.split(' ')) assert.match(acs, new RegExp(String.raw`\b${ac}\b`), `${flow} claims ${ac}`);
    }
    for (const flow of COMMON) {
      assert.match(flowText(flow), /^# EVM-108 AC\d/m, flow);
      assert.match(flowText(flow), new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
    }
  });

  it('EVM-108 AC7: the flows 80-89 are exactly the flows of the camera scenarios (none left out), and no other scenario uses them', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^8\d-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(cameraFlows, files);
    const others = new Set([...SCENARIOS, ...UPLOAD_SCENARIOS].flatMap((scenario) => scenario.steps.map((step) => step.flow)));
    for (const flow of cameraFlows) assert.equal(others.has(flow), false, flow);
    assert.equal(cameraFlows.length, 10);
  });

  it('EVM-108 AC1: the review screenshots of all flows have distinct kebab-case names (they are collected flat)', () => {
    const names = readdirSync(FLOWS)
      .filter((name) => name.endsWith('.yaml'))
      .flatMap((flow) => [...flowText(flow).matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1]));
    assert.equal(new Set(names).size, names.length);
    const own = cameraFlows.flatMap((flow) => [...flowText(flow).matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1] ?? ''));
    assert.ok(own.length >= 15);
    for (const name of own) assert.match(name, /^m0\d-[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('EVM-108 AC1: every camera scenario is outside the default run, starts with the sign-in of the upload part, resets the scenario server and uses known steps only', () => {
    const names = CAMERA_SCENARIOS.map((scenario) => scenario.name);
    assert.equal(new Set(names).size, names.length);
    for (const scenario of CAMERA_SCENARIOS) {
      assert.ok(scenario.name.startsWith('camera-'), scenario.name);
      const first = /** @type {NonNullable<(typeof scenario.steps)[number]>} */ (scenario.steps[0]);
      assert.equal(first.flow, '80-camera-sign-in.yaml', scenario.name);
      assert.equal(first.airplane, false, scenario.name);
      assert.equal(first.before?.[0], 'upload-reset', scenario.name);
      assert.ok(
        first.before.some((action) => action.startsWith('upload-part-delay:')),
        scenario.name,
      );
      for (const step of scenario.steps) assert.equal(step.upload, true, `${scenario.name} ${step.flow}`);
    }
    for (const step of steps)
      for (const action of [...(step.before ?? []), ...(step.after ?? [])])
        assert.ok(isUploadAction(action) || isCameraAction(action) || LOCAL_ACTIONS.has(action), `${step.flow}: ${action}`);
    assert.equal(
      SCENARIOS.some((scenario) => scenario.name.startsWith('camera-')),
      false,
    );
    assert.deepEqual(
      selectScenarios(['camera-']).map((scenario) => scenario.name),
      names,
    );
    // `--only upload-` does not pull the camera scenarios in
    assert.equal(
      selectScenarios(['upload-']).some((scenario) => scenario.name.startsWith('camera-')),
      false,
    );
  });

  it('EVM-108 AC1 .. AC7: the scenarios together cover the criteria that Maestro can show (AC1, AC2, AC3, AC5, AC6, AC7)', () => {
    const covered = new Set(CAMERA_SCENARIOS.flatMap((scenario) => [...scenario.ac.matchAll(/AC\d/g)].map((match) => match[0])));
    assert.deepEqual([...covered].sort(), ['AC1', 'AC2', 'AC3', 'AC5', 'AC6', 'AC7']);
  });

  it('EVM-108 AC1: the real shots are judged for the location (EXIF, gallery, permissions) with the emulator given a location first', () => {
    for (const [name = '', flow = ''] of [
      ['camera-capture', '82-camera-capture.yaml'],
      ['camera-series-offline', '83-camera-series-offline.yaml'],
    ]) {
      const step = CAMERA_SCENARIOS.find((scenario) => scenario.name === name)?.steps.find((candidate) => candidate.flow === flow);
      assert.ok(step !== undefined, name);
      assert.ok(step.before?.includes('camera-grant') && step.before.includes('camera-geo-fix'), name);
      for (const action of [/^original-exif-clean:\d$/, /^gallery-unchanged$/, /^permissions-minimal$/])
        assert.ok(
          step.after?.some((candidate) => action.test(candidate)),
          `${name}: ${String(action)}`,
        );
      // the baseline of the gallery is taken before the shots
      assert.ok(CAMERA_SCENARIOS.find((scenario) => scenario.name === name)?.steps[0]?.after?.includes('gallery-baseline'), name);
    }
    assert.ok(/original-exif-clean:2/.test(JSON.stringify(CAMERA_SCENARIOS.find((s) => s.name === 'camera-capture'))));
    assert.ok(/original-exif-clean:3/.test(JSON.stringify(CAMERA_SCENARIOS.find((s) => s.name === 'camera-series-offline'))));
  });

  it('EVM-108 AC3: the sign-in starts without the camera permission, the consent flow revokes it and asks for no other permission', () => {
    const signIn = flowText('80-camera-sign-in.yaml');
    assert.match(signIn, /launchApp:\n {4}clearState: true\n {4}permissions:\n {6}all: allow\n {6}camera: unset/);
    const scenario = CAMERA_SCENARIOS.find((candidate) => candidate.name === 'camera-permission');
    assert.deepEqual(scenario?.steps[1]?.before, ['camera-revoke']);
    assert.deepEqual(scenario.steps[1].after, ['permissions-minimal']);
    const flow = flowText('81-camera-permission.yaml');
    for (const text of ['Aparat do zdjęć z prac', 'Zezwól na dostęp do aparatu', 'Nie teraz', 'permission_deny_button'])
      assert.ok(flow.includes(text), text);
    assert.match(flow, /launchApp:\r?\n {4}stopApp: false\r?\n(?: {4}#.*\r?\n)? {4}permissions:\r?\n {6}camera: unset/);
    assert.match(flow, /Nic nie czeka na wysłanie\\\./);
  });

  it('EVM-108 AC5 AC6: the offline series runs in airplane mode with the permission to notify denied, and the hidden-data flow reads numbers and the bar of the camera', () => {
    const series = CAMERA_SCENARIOS.find((candidate) => candidate.name === 'camera-series-offline')?.steps[1];
    assert.equal(series?.airplane, true);
    const text = flowText('83-camera-series-offline.yaml');
    assert.match(text, /permissions:\n {6}notifications: deny/);
    for (const part of [
      'Offline · [0-9]+',
      "assertNotVisible: 'Brak zasięgu.*'",
      'Powiadomienia o wysyłaniu',
      'notification-consent-later',
      "text: '3 do wysłania'",
    ])
      assert.ok(text.includes(part), part);
    const hidden = flowText('85-camera-hidden.yaml');
    for (const part of [
      'e2e-lock-off',
      "visible: 'Włącz blokadę ekranu'",
      'Dane zleceń są ukryte — wpis dodasz po ponownym zalogowaniu',
      "assertNotVisible: 'ZL-E2E-1 · .*'",
      "assertVisible: 'Aparat'",
      "assertNotVisible: 'ZL-E2E-1'",
    ])
      assert.ok(hidden.includes(part), part);
    const sheet = flowText('84-camera-add-sheet.yaml');
    for (const part of ['add-media', 'Ostatnio otwierane', 'media-picker-search', 'media-picker-30000000-0000-4000-8000-000000000002'])
      assert.ok(sheet.includes(part), part);
  });

  it('EVM-108 AC7: the 30-shot scenario saves offline, kills the app, restarts offline, returns the network, interrupts the transfer twice and judges the server at the end', () => {
    const scenario = CAMERA_SCENARIOS.find((candidate) => candidate.name === 'camera-batch-30');
    assert.ok(scenario);
    assert.deepEqual(
      scenario.steps.map((step) => [step.flow, step.airplane, step.after ?? []]),
      [
        ['80-camera-sign-in.yaml', false, []],
        ['86-camera-batch-inject.yaml', true, ['kill-9']],
        ['87-camera-batch-after-kill.yaml', true, ['jobs-none', 'upload-none-yet']],
        ['88-camera-batch-uploading.yaml', false, ['force-stop']],
        ['89-camera-batch-sent.yaml', false, ['upload-checkpoint-many:30', 'tokens-not-in-clear', 'logcat-clean']],
      ],
    );
    // the answer to a part is held: thirty files are still on their way when the app is interrupted
    assert.match(
      scenario.steps[0]?.before?.find((action) => action.startsWith('upload-part-delay:')) ?? '',
      /^upload-part-delay:[1-9]\d{3,}$/,
    );
    assert.equal(scenario.steps[3]?.background, true);
    // the delay outlasts both interruptions (the resume skips the parts the server holds) and is dropped for the last step, which waits for the end
    assert.ok(Number(scenario.steps[0]?.before?.find((action) => action.startsWith('upload-part-delay:'))?.slice(18)) >= 10_000);
    assert.deepEqual(scenario.steps[4]?.before, ['upload-part-delay:0']);
  });

  it('EVM-108 AC7: the flows of the 30 shots use the hook through its ids, wait for the confirmation of the LAST save and count the states from the snapshot of the Queue', () => {
    const inject = flowText('86-camera-batch-inject.yaml');
    assert.match(inject, /id: 'e2e-capture-count'\n- eraseText\n- inputText: '30'\n- hideKeyboard/);
    assert.match(inject, /text: 'capture_added=30'/);
    // below the fold of the panel: scrolled to first, with the element centred
    assert.match(inject, /scrollUntilVisible:\n {4}element:\n {6}id: 'e2e-capture-batch'\n {4}direction: DOWN\n {4}centerElement: true/);
    assert.match(flowText('87-camera-batch-after-kill.yaml'), /text: '30 do wysłania'/);
    assert.match(flowText('87-camera-batch-after-kill.yaml'), /STATUS: 'files=30;waiting=30;uploading=0;sent=0;failed=0;attention=0;/);
    assert.match(flowText('88-camera-batch-uploading.yaml'), /\.\*Wysyła się \[0-9\]\+%/);
    const sent = flowText('89-camera-batch-sent.yaml');
    assert.match(sent, /text: '0 do wysłania'/);
    assert.match(sent, /STATUS: 'files=30;waiting=0;uploading=0;sent=30;failed=0;attention=0;/);
    assert.match(sent, /assertNotVisible: 'Wylogowano ten telefon'/);
    assert.match(flowText('common/media-status.yaml'), /text: \$\{STATUS\}/);
  });

  it('EVM-108 AC7: no flow uses a coordinate, the temporary hook of the camera entry is gone, and the lessons of the earlier flows are kept (the keyboard is hidden only after typing)', () => {
    for (const flow of [...cameraFlows, ...COMMON]) {
      const text = flowText(flow);
      assert.doesNotMatch(text, /\bpoint:|^- tapOn: \d/m, flow);
      assert.doesNotMatch(text, /e2e-camera-open/, flow);
      // every `hideKeyboard` comes right after an `inputText`
      for (const match of text.matchAll(/^- hideKeyboard$/gm)) {
        const before = text.slice(0, match.index).trimEnd().split('\n').at(-1) ?? '';
        assert.match(before, /^- inputText:/, `${flow}: hideKeyboard without typing before it`);
      }
    }
  });

  it('EVM-108 AC5: every id and every text a flow looks for exists in the app (the ids in the source of the screens and of the hooks, the texts in the Polish catalogue or the scenario server)', () => {
    const code = sources(join(APP, 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const catalogue = [
      readFileSync(join(APP, 'src', 'i18n', 'pl.ts'), 'utf8'),
      ...['sync-stub.mjs', 'stub-api.mjs', 'upload-stub.mjs'].map((name) =>
        readFileSync(join(import.meta.dirname, '..', 'src', name), 'utf8'),
      ),
    ].join('\n');
    const prefixes = [...code.matchAll(/testID(?:Prefix)?=\{?[`"']([a-z0-9-]+)-?\$?\{?/g)].map((match) => match[1] ?? '');
    const templates = [...code.matchAll(/`([a-z0-9-]+-)\$\{/g)].map((match) => match[1] ?? '');
    for (const flow of [...cameraFlows, ...COMMON]) {
      const text = flowText(flow);
      for (const match of text.matchAll(/^\s+id: '([^']+)'/gm)) {
        const id = match[1] ?? '';
        if (id.startsWith('.*')) continue; // an id of the system dialog (a regex)
        const known =
          code.includes(`'${id}'`) ||
          code.includes(`"${id}"`) ||
          templates.some((prefix) => id.startsWith(prefix)) ||
          prefixes.some((prefix) => id.startsWith(`${prefix}-`));
        assert.ok(known, `${flow}: id ${id} is in no screen of the app`);
      }
      const texts = [
        ...text.matchAll(/^(?:- )?(?:assertVisible|assertNotVisible|visible|notVisible): '([^']+)'/gm),
        ...text.matchAll(/^\s+text: '([^']+)'/gm),
      ];
      for (const match of texts) {
        const value = (match[1] ?? '').replaceAll(String.raw`\.`, '.').replaceAll(String.raw`\?`, '?');
        if (value.includes('=')) continue; // a status line of the hook
        for (const chunk of value.split(/\.\*|[()|]|\[[^\]]*\]\+?|, /).filter((part) => part.trim().length >= 5)) {
          assert.ok(
            catalogue.includes(
              chunk
                .trim()
                .replace(/^\d+ /, '')
                .replace(/ ·$/, '')
                .replace(/^ZL-E2E-\d$/, 'ZL-E2E-'),
            ) || code.includes(chunk.trim()),
            `${flow}: the text "${chunk}" is nowhere in the app`,
          );
        }
      }
    }
  });
});
