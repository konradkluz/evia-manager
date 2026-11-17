import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runDeviceAction } from '../src/device.mjs';
import { isSurveyAction, judgeLogcatNoSurveyData, SURVEY_SYNTHETIC_WORDS } from '../src/device-survey.mjs';

/** @param {number | null} status @param {string} [stdout] */
const out = (status, stdout = '') => ({ status, stdout, stderr: '' });

describe('the device step of the site survey scenarios (EVM-137 W5)', () => {
  it('EVM-137 W5: the step is recognised by its name and only by it', () => {
    assert.equal(isSurveyAction('logcat-no-survey-data'), true);
    assert.equal(isSurveyAction('logcat-clean'), false);
    assert.equal(isSurveyAction('nope'), false);
  });

  it('EVM-137 W5: the words of the flows (city, street, postal code, phone) are not in the log - the clean log passes, with the number of lines only', () => {
    const verdict = judgeLogcatNoSurveyData(out(0, '11-16 I/ReactNativeJS( 1): running\n11-16 D/EviaSync( 1): batch of 2\n'));
    assert.equal(verdict.ok, true);
    assert.match(verdict.detail, /\(\d+ lines\)/);
  });

  it('EVM-137 W5: a line with any of the words fails the step, and the detail names the COUNT of lines, never the line', () => {
    for (const word of SURVEY_SYNTHETIC_WORDS) {
      const verdict = judgeLogcatNoSurveyData(out(0, `11-16 W/Something( 1): saved ${word} to the queue\nplain\n`));
      assert.equal(verdict.ok, false, word);
      assert.match(verdict.detail, /1 line/);
      assert.doesNotMatch(verdict.detail, new RegExp(word));
    }
  });

  it('EVM-137 W5: the typing of the Maestro driver is not the app (the driver logs what it types) and is left out of the judgement', () => {
    const verdict = judgeLogcatNoSurveyData(out(0, '11-16 I/Maestro( 9): inputText Piaseczno\n11-16 I/Maestro(9): tap\n'));
    assert.equal(verdict.ok, true);
  });

  it('EVM-137 W5: a log that cannot be read is a failure, not a pass', () => {
    assert.equal(judgeLogcatNoSurveyData(out(1)).ok, false);
  });

  it('EVM-137 W5: runDeviceAction routes the step to the module and reads the log through adb', async () => {
    /** @type {string[][]} */
    const calls = [];
    const check = await runDeviceAction(
      'logcat-no-survey-data',
      /** @type {never} */ ({
        adb: (/** @type {string[]} */ ...args) => {
          calls.push(args);
          return out(0, 'plain\n');
        },
        // the other fields of the context are not used by this step
      }),
    );
    assert.equal(check.ok, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(0, 2), ['logcat', '-d']);
  });
});
