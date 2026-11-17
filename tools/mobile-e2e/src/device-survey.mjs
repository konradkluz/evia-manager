// @ts-check
/**
 * The device step of the site survey scenarios (EVM-137, security W5: the address and the phone of the requester are never in a log): after a
 * scenario the log of the device must not carry any of the synthetic words the flows type. The words are invented (the flows `common/survey-
 * create.yaml` types them), so a hit is the app writing a typed value into the log, and the detail of a failure is the COUNT of lines - never a
 * line. The typing of the Maestro driver is left out (the driver logs what it types; it is not the app).
 * @typedef {'logcat-no-survey-data'} SurveyAction
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Outcome
 * @typedef {{ adb: (...args: string[]) => Outcome }} SurveyContext
 */
import { MAESTRO_LINE, uploadCommands } from './device-upload.mjs';

export const SURVEY_ACTION_NAMES = new Set(['logcat-no-survey-data']);

/** What the flows type: the city, the street, the postal code and the phone of the requester (apps/mobile/e2e/common/survey-create.yaml). */
export const SURVEY_SYNTHETIC_WORDS = Object.freeze(['Fikcyjna', 'Piaseczno', '05-500', '600000011']);

const NEWLINE = /\r?\n/;

/** @param {string} action @returns {boolean} */
export function isSurveyAction(action) {
  return SURVEY_ACTION_NAMES.has(action.split(':')[0] ?? '');
}

/**
 * @param {Outcome} logcat
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeLogcatNoSurveyData(logcat) {
  if (logcat.status !== 0) return { ok: false, detail: 'logcat could not be read' };
  const lines = logcat.stdout.split(NEWLINE).filter((line) => !MAESTRO_LINE.test(line));
  const hits = lines.filter((line) => SURVEY_SYNTHETIC_WORDS.some((word) => line.includes(word))).length;
  return hits === 0
    ? { ok: true, detail: `logcat (${String(lines.length)} lines): no address and no phone of a site survey` }
    : { ok: false, detail: `logcat: ${String(hits)} line(s) with a typed value of a site survey` };
}

/**
 * @param {SurveyAction} action
 * @param {SurveyContext} context
 * @returns {Promise<{ action: SurveyAction, ok: boolean, detail: string }>}
 */
export function runSurveyAction(action, context) {
  const verdict = judgeLogcatNoSurveyData(context.adb(...uploadCommands.logcat()));
  return Promise.resolve({ action, ok: verdict.ok, detail: verdict.detail });
}
