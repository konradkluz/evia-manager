import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APPLICATION_ID } from '../src/commands.mjs';
import { runDeviceAction } from '../src/device.mjs';
import {
  compareDumps,
  COVER_ID,
  COVER_TITLE,
  findLeaks,
  isLockAction,
  judgeViewTree,
  LOCK_CONTROL_VALUES,
  lockCommands,
  parseViewTree,
  runLockAction,
  SAMPLES,
  unescapeXml,
} from '../src/device-lock.mjs';
import { LOCK_SCENARIOS } from '../src/lock-scenarios.mjs';
import { selectScenarios } from '../src/upload-scenarios.mjs';

/** @param {number | null} status @param {string} [stdout] */
const out = (status, stdout = '') => ({ status, stdout, stderr: '' });

/** @param {Record<string, string>} a @param {string} [pkg] */
const node = (a, pkg = APPLICATION_ID) =>
  `<node index="0" text="${a['text'] ?? ''}" resource-id="${a['id'] ?? ''}" class="android.view.View" package="${pkg}" content-desc="${a['desc'] ?? ''}" hint="${a['hint'] ?? ''}" bounds="[0,0][1,1]" />`;
const tree = (/** @type {string[]} */ ...nodes) =>
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>\nUI hierchary dumped to: /dev/tty`;
const cover = [node({ id: COVER_ID }), node({ text: COVER_TITLE }), node({ id: 'lock-unlock', text: 'Odblokuj' })];

describe('the tree of views of the locked app (EVM-146 AC1)', () => {
  it('EVM-146 AC1: the step is recognised by its name and only by it', () => {
    assert.equal(isLockAction('view-tree-locked'), true);
    assert.equal(isLockAction('logcat-clean'), false);
  });

  it('EVM-146 AC1: the dump is read without compression (the views not important for accessibility are in it)', () => {
    assert.ok(!lockCommands.dump().join(' ').includes('--compressed'));
    assert.ok(lockCommands.dumpCompressed().join(' ').includes('--compressed'));
  });

  it('EVM-146 AC1: the parser reads text, content-desc, hint, resource-id and package, unescapes the XML and refuses a text with no hierarchy', () => {
    const nodes = parseViewTree(tree(node({ text: 'A &amp; B &#x105; &#261; &lt;&gt;&quot;&apos;', id: 'x', desc: 'd', hint: 'h' })));
    assert.deepEqual(nodes, [{ text: 'A & B ą ą <>"\'', contentDesc: 'd', hint: 'h', resourceId: 'x', packageName: APPLICATION_ID }]);
    assert.equal(parseViewTree('ERROR: could not get idle state.'), null);
    assert.deepEqual(parseViewTree('<hierarchy rotation="0"></hierarchy>'), []);
    assert.equal(unescapeXml('plain'), 'plain');
    // a node without the attribute reads as empty
    assert.equal(parseViewTree('<hierarchy><node index="0" class="a" /></hierarchy>')?.[0]?.hint, '');
  });

  it('EVM-146 AC1: every control value is found in each of the four attributes, case-insensitively', () => {
    /** @type {[string, string][]} */
    const attributes = [
      ['text', 'text'],
      ['desc', 'content-desc'],
      ['hint', 'hint'],
      ['id', 'resource-id'],
    ];
    for (const [name, value] of Object.entries(LOCK_CONTROL_VALUES)) {
      for (const [key, attribute] of attributes) {
        const nodes = parseViewTree(tree(node({ [key]: `x ${value.toUpperCase()} y` }))) ?? [];
        const leaks = findLeaks(nodes);
        assert.ok(
          leaks.some((leak) => leak.value === name && leak.attribute === attribute),
          `${name} in ${attribute}`,
        );
      }
    }
  });

  it('EVM-146 AC1: a tree with the cover and nothing else passes', () => {
    const verdict = judgeViewTree(out(0, tree(...cover, node({ text: 'something neutral' }), node({ text: 'x' }, 'com.android.systemui'))));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.nodes, 4);
  });

  it('EVM-146 AC1: a value anywhere in the tree below the cover fails the step and the detail names the value and the attribute, never the line', () => {
    const verdict = judgeViewTree(
      out(
        0,
        tree(
          ...cover,
          node({ id: 'order-row-30000000-0000-4000-8000-000000000001' }),
          node({ text: 'ZL-E2E-1' }),
          node({ desc: 'Kontrolka146' }),
        ),
      ),
    );
    assert.equal(verdict.ok, false);
    assert.match(verdict.detail, /order id in resource-id \(1\)/);
    assert.match(verdict.detail, /order number in text \(1\)/);
    assert.match(verdict.detail, /typed value in content-desc \(1\)/);
    assert.doesNotMatch(verdict.detail, /<node/);
  });

  it('EVM-146 AC1: a value in a window of another package is not the leak of the app', () => {
    const verdict = judgeViewTree(out(0, tree(...cover, node({ text: 'ZL-E2E-1' }, 'com.other.app'))));
    assert.equal(verdict.ok, true);
  });

  it('EVM-146 AC1: an empty, unreadable or foreign dump is a FAILURE - an empty proof is not a pass', () => {
    assert.equal(judgeViewTree(out(1)).ok, false);
    assert.equal(judgeViewTree(out(0, '')).ok, false);
    assert.match(judgeViewTree(out(0, 'ERROR: null root node returned by UiTestAutomationBridge.')).detail, /empty/);
    assert.match(judgeViewTree(out(0, '<hierarchy rotation="0"></hierarchy>')).detail, /empty/);
    const foreign = judgeViewTree(out(0, tree(node({ text: 'Settings' }, 'com.android.settings'))));
    assert.equal(foreign.ok, false);
    assert.match(foreign.detail, /none of the app/);
  });

  it('EVM-146 AC1: a tree of the app without the cover is a failure (the app is not locked - the dump may not be of the right moment)', () => {
    const verdict = judgeViewTree(out(0, tree(node({ text: 'Moje zlecenia' }))));
    assert.equal(verdict.ok, false);
    assert.match(verdict.detail, /not the cover/);
  });

  it('EVM-146 AC1: the cover is recognised by its title alone as well as by its test id', () => {
    assert.equal(judgeViewTree(out(0, tree(node({ text: COVER_TITLE })))).ok, true);
    assert.equal(judgeViewTree(out(0, tree(node({ id: `pl.eviacharge.manager:id/${COVER_ID}` })))).ok, true);
  });

  it('EVM-146 AC1: the two dumps are compared by the nodes of the app; a failed dump gives no comparison', () => {
    const full = tree(...cover, node({ text: 'a' }), node({ text: 'b' }));
    const compressed = tree(...cover);
    assert.deepEqual(compareDumps(out(0, full), out(0, compressed)), { full: 5, compressed: 3 });
    assert.deepEqual(compareDumps(out(0, 'garbage'), out(0, compressed)), { full: 0, compressed: 3 });
    assert.equal(compareDumps(out(1), out(0, compressed)), null);
    assert.equal(compareDumps(out(0, full), out(1)), null);
  });

  it('EVM-146 AC1: the step samples the tree several times and one dirty sample fails it; the pauses go through the sleep of the context', async () => {
    /** @type {number[]} */
    const sleeps = [];
    let reads = 0;
    const adb = (/** @type {string[]} */ ...args) => {
      if (args.join(' ').includes('--compressed')) return out(0, tree(...cover));
      reads += 1;
      return out(0, reads === 2 ? tree(...cover, node({ text: 'Klient Testowy 1' })) : tree(...cover));
    };
    const check = await runLockAction('view-tree-locked', {
      adb,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    assert.equal(check.ok, false);
    assert.match(check.detail, /#2 FAIL/);
    assert.match(check.detail, /#1 ok/);
    assert.match(check.detail, /uncompressed \d+, compressed 3/);
    assert.equal(sleeps.length, SAMPLES - 1);
  });

  it('EVM-146 AC1: a clean tree in every sample passes; without a comparison of the dumps the step still judges', async () => {
    const adb = (/** @type {string[]} */ ...args) => (args.join(' ').includes('--compressed') ? out(1) : out(0, tree(...cover)));
    const check = await runDeviceAction('view-tree-locked', /** @type {never} */ ({ adb, sleep: () => Promise.resolve() }));
    assert.equal(check.ok, true);
    assert.doesNotMatch(check.detail, /compressed/);
  });

  it('EVM-146 AC1: the lock scenario is selectable by the prefix `lock-` and ends with the step after the flow of the lock', () => {
    assert.deepEqual(
      selectScenarios(['lock-']).map((scenario) => scenario.name),
      ['lock-view-tree'],
    );
    const [scenario] = LOCK_SCENARIOS;
    assert.ok(scenario);
    assert.equal(scenario.steps.at(-1)?.flow, '130-lock-view-tree.yaml');
    assert.deepEqual(scenario.steps.at(-1)?.after, ['view-tree-locked']);
    assert.match(scenario.ac, /EVM-146 AC1/);
  });
});
