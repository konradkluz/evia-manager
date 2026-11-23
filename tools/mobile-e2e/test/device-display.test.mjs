import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runDeviceAction } from '../src/device.mjs';
import {
  densityFor,
  displayCommands,
  isDisplayAction,
  parseDisplayAction,
  physicalWidth,
  runDisplayAction,
  SETTLE_MS,
} from '../src/device-display.mjs';

/** @param {number | null} status @param {string} [stdout] */
const out = (status, stdout = '') => ({ status, stdout, stderr: '' });

/** A fake device: records the adb calls and the pauses; `fail` names the first word of a command that fails. */
function rig(/** @type {string | null} */ fail = null, /** @type {string} */ size = 'Physical size: 1080x2400\n') {
  /** @type {string[][]} */
  const calls = [];
  /** @type {number[]} */
  const pauses = [];
  return {
    calls,
    pauses,
    context: {
      adb: (/** @type {string[]} */ ...args) => {
        calls.push(args);
        if (fail !== null && args.includes(fail)) return out(1);
        return args.includes('size') ? out(0, size) : out(0);
      },
      sleep: (/** @type {number} */ ms) => {
        pauses.push(ms);
        return Promise.resolve();
      },
    },
  };
}

describe('the display steps of the font-scale scenarios (EVM-151 AC5)', () => {
  it('EVM-151 AC5: the steps are recognised by their name only', () => {
    assert.equal(isDisplayAction('display:font=2'), true);
    assert.equal(isDisplayAction('display-reset'), true);
    assert.equal(isDisplayAction('displays'), false);
    assert.equal(isDisplayAction('force-stop'), false);
  });

  it('EVM-151 AC5: a setting is the font scale with an optional width in dp, and nothing else', () => {
    assert.deepEqual(parseDisplayAction('display:font=2'), { fontScale: 2, widthDp: null });
    assert.deepEqual(parseDisplayAction('display:font=1.3,dp=360'), { fontScale: 1.3, widthDp: 360 });
    for (const bad of [
      'display-reset',
      'display:',
      'display:dp=360',
      'display:font=3',
      'display:font=0.5',
      'display:font=2,dp=100',
      'display:font=2,dp=700',
      'display:font=2,dp=360.5',
      'display:font=2,font=2',
      'display:font=two',
      'display:font=2,x=1',
      'display:font=2;rm',
    ])
      assert.equal(parseDisplayAction(bad), null, bad);
  });

  it('EVM-151 AC5: the width in pixels is read from "wm size" (the override line is ignored) and the density gives the wanted width in dp', () => {
    assert.equal(physicalWidth('Physical size: 1080x2400\nOverride size: 720x1600\n'), 1080);
    assert.equal(physicalWidth('nothing'), null);
    assert.equal(densityFor(1080, 360), 480);
    assert.equal(densityFor(1080, 411), 420);
  });

  it('EVM-151 AC5: the font scale alone changes only the font, then waits for the layout', async () => {
    const { calls, pauses, context } = rig();
    const result = await runDisplayAction('display:font=2', context);
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [displayCommands.setFont(2)]);
    assert.deepEqual(pauses, [SETTLE_MS]);
  });

  it('EVM-151 AC5: with a width the density of the screen is set for it (1080 px, 360 dp = 480 dpi)', async () => {
    const { calls, context } = rig();
    const result = await runDisplayAction('display:font=2,dp=360', context);
    assert.equal(result.ok, true);
    assert.match(result.detail, /360 dp/);
    assert.deepEqual(calls, [displayCommands.setFont(2), displayCommands.size(), displayCommands.setDensity(480)]);
  });

  it('EVM-151 AC5: an invalid setting, a font that cannot be set, a size that cannot be read and a density that cannot be set are failures', async () => {
    assert.equal((await runDisplayAction('display:font=9', rig().context)).ok, false);
    assert.equal((await runDisplayAction('display:font=2', rig('font_scale').context)).ok, false);
    assert.equal((await runDisplayAction('display:font=2,dp=360', rig('size').context)).ok, false);
    assert.equal((await runDisplayAction('display:font=2,dp=360', rig(null, 'garbage').context)).ok, false);
    assert.equal((await runDisplayAction('display:font=2,dp=360', rig('density').context)).ok, false);
  });

  it('EVM-151 AC5: the reset puts back the font scale and the density; a failure of either is a failure of the step', async () => {
    const good = rig();
    assert.equal((await runDisplayAction('display-reset', good.context)).ok, true);
    assert.deepEqual(good.calls, [displayCommands.setFont(1), displayCommands.resetDensity()]);
    assert.equal((await runDisplayAction('display-reset', rig('font_scale').context)).ok, false);
    assert.equal((await runDisplayAction('display-reset', rig('density').context)).ok, false);
  });

  it('EVM-151 AC5: runDeviceAction routes the steps to the module', async () => {
    const { calls, context } = rig();
    const check = await runDeviceAction('display-reset', /** @type {never} */ (context));
    assert.equal(check.ok, true);
    assert.equal(calls.length, 2);
  });
});
