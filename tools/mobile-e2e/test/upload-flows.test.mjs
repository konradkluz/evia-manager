import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { isUploadAction } from '../src/device-upload.mjs';
import { SCENARIOS } from '../src/scenarios.mjs';
import { selectScenarios, UPLOAD_SCENARIOS } from '../src/upload-scenarios.mjs';

const APP = join(import.meta.dirname, '..', '..', '..', 'apps', 'mobile');
const FLOWS = join(APP, 'e2e');
/** @param {readonly string[] | undefined} list @param {string} action */
const has = (list, action) => list?.includes(action) ?? false;
/** The steps of src/device.mjs (EVM-093 and the interruptions). */
const LOCAL_ACTIONS = new Set(['force-stop', 'kill-9', 'reboot']);

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const steps = UPLOAD_SCENARIOS.flatMap((scenario) => scenario.steps);
const uploadFlows = [...new Set(steps.map((step) => step.flow))].sort();
const flowText = (/** @type {string} */ flow) => readFileSync(join(FLOWS, flow), 'utf8');

describe('Maestro flows 50-69 and the upload scenarios agree (EVM-130 stage C)', () => {
  it('EVM-130 AC1: every flow of an upload scenario exists, belongs to the application id and names its acceptance criterion in the header', () => {
    // a flow shared by several scenarios claims criteria that the scenarios using it state together
    /** @type {Map<string, string>} */
    const stated = new Map();
    for (const scenario of UPLOAD_SCENARIOS)
      for (const step of scenario.steps) stated.set(step.flow, `${stated.get(step.flow) ?? ''} ${scenario.ac}`);
    for (const [flow, acs] of stated) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`^appId: ${APPLICATION_ID.replaceAll('.', String.raw`\.`)}$`, 'm'), flow);
      const claimed = /^# EVM-130 (AC\d(?: AC\d)*)/m.exec(text)?.[1];
      assert.ok(claimed !== undefined, `${flow}: no "# EVM-130 AC<n>" header`);
      for (const ac of claimed.split(' ')) assert.match(acs, new RegExp(String.raw`\b${ac}\b`), `${flow} claims ${ac}`);
    }
  });

  it('EVM-130 AC1: the flows 50-69 are exactly the flows of the upload scenarios (none left out), and they are in the range of this story', () => {
    const files = readdirSync(FLOWS)
      .filter((name) => /^(5\d|6\d)-.*\.yaml$/.test(name))
      .sort();
    assert.deepEqual(uploadFlows, files);
    // the other flows of the app are in scenarios.mjs, none of them is an upload flow
    const base = new Set(SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.flow)));
    for (const flow of uploadFlows) assert.equal(base.has(flow), false, flow);
  });

  it('EVM-130 AC1: the review screenshots of all flows have distinct kebab-case names (they are collected flat)', () => {
    const names = readdirSync(FLOWS)
      .filter((name) => name.endsWith('.yaml'))
      .flatMap((flow) => [...flowText(flow).matchAll(/^- takeScreenshot: (\S+)$/gm)].map((match) => match[1]));
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.match(name ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(names.filter((name) => name?.startsWith('u130-')).length >= 15);
  });

  it('EVM-130 AC1: every upload scenario starts with the sign-in, resets the scenario server first and serves the sign-in from the upload part in every step', () => {
    for (const scenario of UPLOAD_SCENARIOS) {
      const first = /** @type {NonNullable<(typeof scenario.steps)[number]>} */ (scenario.steps[0]);
      assert.equal(first.flow, '50-upload-sign-in.yaml', scenario.name);
      assert.equal(first.before?.[0], 'upload-reset', scenario.name);
      assert.equal(
        first.before.some((action) => action.startsWith('upload-size')),
        false,
        scenario.name,
      );
      assert.ok(
        first.before.some((action) => action.startsWith('upload-part-delay:')),
        scenario.name,
      );
      assert.ok(scenario.name.startsWith('upload-'), scenario.name);
      for (const step of scenario.steps) assert.equal(step.upload, true, `${scenario.name} ${step.flow}`);
    }
    assert.equal(new Set(UPLOAD_SCENARIOS.map((scenario) => scenario.name)).size, UPLOAD_SCENARIOS.length);
  });

  it('EVM-130 AC1: every action of a step is a known device or server step', () => {
    for (const step of steps) {
      for (const action of [...(step.before ?? []), ...(step.after ?? [])])
        assert.ok(isUploadAction(action) || LOCAL_ACTIONS.has(action), `${step.flow}: ${action}`);
    }
  });

  it('EVM-130 AC1 .. AC6: the scenarios together cover every criterion of the stage (AC1-AC6)', () => {
    const covered = new Set(UPLOAD_SCENARIOS.flatMap((scenario) => [...scenario.ac.matchAll(/AC\d/g)].map((match) => match[0])));
    assert.deepEqual([...covered].sort(), ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6']);
  });

  it('EVM-130 AC1: the interruption scenario kills, force-stops, cuts the network and restarts the emulator, and proves the job only after `applied`', () => {
    const scenario = UPLOAD_SCENARIOS.find((entry) => entry.name === 'upload-interruptions');
    assert.ok(scenario);
    const after = scenario.steps.flatMap((step) => step.after ?? []);
    for (const action of [
      'kill-9',
      'force-stop',
      'reboot',
      'upload-checkpoint:4',
      'original-present',
      'tokens-not-in-clear',
      'logcat-clean',
    ])
      assert.ok(has(after, action), action);
    // offline first: no job, nothing at the server; only then (network back) the job is armed
    const offline = scenario.steps.findIndex((step) => step.flow === '51-upload-offline-inject.yaml');
    assert.equal(scenario.steps[offline]?.airplane, true);
    assert.deepEqual(scenario.steps[offline].after, ['jobs-none', 'upload-none-yet']);
    const armed = scenario.steps.findIndex((step) => step.after?.includes('jobs-armed'));
    assert.ok(armed > offline);
    assert.equal(scenario.steps[armed]?.airplane, false);
    // the network is cut once in the middle of the transfer, and the sequence ends with the network on
    assert.equal(scenario.steps.filter((step) => step.flow === '53-upload-airplane.yaml' && step.airplane).length, 1);
    assert.equal(scenario.steps.at(-1)?.airplane, false);
    // the restart of the emulator happens with the network on (the runner assumes it is off afterwards)
    const reboot = scenario.steps.find((step) => step.after?.includes('reboot'));
    assert.equal(reboot?.airplane, false);
  });

  it('EVM-130 AC5: a revoked session is cleared at the server before the sign-in again, and the transfer ends with the checkpoint', () => {
    const scenario = UPLOAD_SCENARIOS.find((entry) => entry.name === 'upload-session-revoked');
    assert.ok(scenario);
    const fault = scenario.steps.findIndex((step) => step.after?.includes('upload-fault:session_revoked'));
    const clear = scenario.steps.findIndex((step) => step.before?.includes('upload-fault-clear:session_revoked'));
    assert.ok(fault >= 0 && clear > fault);
    assert.ok(scenario.steps[clear]?.after?.includes('upload-checkpoint:2'));
  });

  it('EVM-130 AC4: the original is proven present until `clean` and gone after it; a failed file and a quarantined one keep the original', () => {
    const clean = UPLOAD_SCENARIOS.find((entry) => entry.name === 'upload-original-until-clean');
    assert.ok(clean);
    const present = clean.steps.findIndex((step) => step.after?.includes('original-present'));
    const absent = clean.steps.findIndex((step) => step.after?.includes('original-absent'));
    assert.ok(present >= 0 && absent > present);
    assert.ok(clean.steps[absent]?.before?.includes('upload-file-state:clean'));
    const verdicts = UPLOAD_SCENARIOS.find((entry) => entry.name === 'upload-file-verdicts');
    assert.ok(verdicts);
    assert.ok(verdicts.steps[0]?.before?.includes('upload-verdict:checksum_mismatch'));
    assert.ok(verdicts.steps.some((step) => step.before?.includes('upload-verdict:none')));
    assert.ok(verdicts.steps.some((step) => step.before?.includes('upload-verdict:quarantined')));
    assert.equal(verdicts.steps.filter((step) => step.after?.includes('original-present')).length, 2);
  });

  it('EVM-130 AC5: the wipe scenarios end with no job, no file and nothing in the log', () => {
    for (const name of ['upload-device-wipe', 'upload-manual-wipe']) {
      const after = UPLOAD_SCENARIOS.find((entry) => entry.name === name)?.steps.at(-1)?.after ?? [];
      for (const action of ['jobs-none', 'app-files-none', 'tokens-not-in-clear', 'logcat-clean'])
        assert.ok(has(after, action), `${name} ${action}`);
    }
  });

  it('EVM-130 AC1: the sizes of the flows decide the parts (the app declares the file in the session): 40 MiB = 10 parts, 24 = 6, 1 = 1 of 4 MiB', () => {
    const size = { '51-upload-offline-inject.yaml': 40, '55-upload-inject-small.yaml': 1, '56-upload-inject-uploading.yaml': 24 };
    for (const [flow, mib] of Object.entries(size)) {
      const text = flowText(flow);
      assert.match(text, new RegExp(`MIB: '${String(mib)}'`), flow);
      assert.match(text, new RegExp(`BYTES: '${String(mib * 1024 * 1024)}'`), flow);
    }
    // the scenarios that interrupt the transfer inject a file of at least 6 parts (the part size of the run is 4 MiB), so there is a part to interrupt
    const injects = {
      'upload-interruptions': '51-upload-offline-inject.yaml',
      'upload-token-refresh': '56-upload-inject-uploading.yaml',
      'upload-session-revoked': '56-upload-inject-uploading.yaml',
      'upload-original-until-clean': '55-upload-inject-small.yaml',
      'upload-file-verdicts': '55-upload-inject-small.yaml',
    };
    for (const [name, flow] of Object.entries(injects)) {
      assert.ok(
        UPLOAD_SCENARIOS.find((entry) => entry.name === name)?.steps.some((step) => step.flow === flow),
        `${name} ${flow}`,
      );
      const parts = Math.ceil((size[/** @type {keyof typeof size} */ (flow)] * 1024 * 1024) / (4 * 1024 * 1024));
      if (flow !== '55-upload-inject-small.yaml') assert.ok(parts >= 6, name);
    }
  });

  it('EVM-130 AC1: the flows name only screen elements and texts that exist in the app (ids in the sources, texts in the Polish catalogue)', () => {
    const code = sources(join(APP, 'src'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const catalogue = readFileSync(join(APP, 'src', 'i18n', 'pl.ts'), 'utf8');
    const flows = [...uploadFlows, 'common/upload-inject.yaml', 'common/sign-in.yaml'];
    for (const flow of flows) {
      const text = flowText(flow);
      // a testID of a row carries the asset id: the flow names it by a regular expression of its start
      for (const match of text.matchAll(/^\s+id: '([^']+)'/gm)) {
        const id = (match[1] ?? '').replace(/\.\*$/, '');
        assert.ok(code.includes(id), `${flow}: no element with the id "${id}"`);
      }
    }
    // the texts of the flows that come from the catalogue (AC4 AC5 AC6)
    for (const sentence of [
      'Nie wysłano — plik uszkodzony w transmisji',
      'Powiadomienia wyłączone — nie zobaczysz, że wysyłanie się zatrzymało.',
      'Dane firmowe usunięte z telefonu',
      'Wylogowano ten telefon',
      'Zaktualizuj aplikację',
      'Plik wymaga uwagi',
      'Dane zleceń są ukryte',
      'Wysłano {{sent}} z {{total}} · {{queued}} w kolejce',
      'Wysyłanie {{percent}}%',
    ])
      assert.ok(catalogue.includes(sentence), sentence);
    const used = uploadFlows.map(flowText).join('\n');
    for (const sentence of [
      'Nie wysłano — plik uszkodzony w transmisji',
      'Plik wymaga uwagi',
      'Wylogowano ten telefon',
      'Zaktualizuj aplikację',
    ])
      assert.ok(used.includes(sentence), sentence);
  });

  it('EVM-130 AC1: the flows scroll under the sticky bar, tap the security banner optionally and never hide the keyboard blindly', () => {
    for (const flow of uploadFlows) {
      const text = flowText(flow);
      // a scroll to an element is centred (it can count as visible under a sticky bar) ...
      for (const block of text.split(/^- scrollUntilVisible:/m).slice(1))
        assert.match(block.split(/^- /m)[0] ?? '', /centerElement: true/, flow);
      // ... the security banner of the emulator is optional ...
      for (const block of text.split(/^- tapOn:\n/m).slice(1)) {
        if (/^\s+text: 'Rozumiem'/.test(block)) assert.match(block.split(/^- /m)[0] ?? '', /optional: true/, flow);
      }
      // ... and the keyboard is hidden only right after a text was typed
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (line.trim() === '- hideKeyboard') assert.match(lines[index - 1] ?? '', /^- inputText:/, `${flow}: hideKeyboard without input`);
      });
    }
    const inject = flowText('common/upload-inject.yaml');
    assert.match(inject, /- inputText: \$\{MIB\}\n- hideKeyboard/);
  });

  it('EVM-130 AC1: --only picks scenarios by name or prefix; without it only the scenarios of scenarios.mjs run', () => {
    assert.equal(selectScenarios(null), SCENARIOS);
    assert.deepEqual(
      selectScenarios(['upload-']).map((scenario) => scenario.name),
      UPLOAD_SCENARIOS.map((scenario) => scenario.name),
    );
    assert.deepEqual(
      selectScenarios(['online', 'upload-permission-banner']).map((scenario) => scenario.name),
      ['online', 'upload-permission-banner'],
    );
    assert.deepEqual(selectScenarios(['nothing-like-it']), []);
  });
});
