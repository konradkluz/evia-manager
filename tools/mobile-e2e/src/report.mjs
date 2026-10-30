// @ts-check
/**
 * Evidence of the smoke test (EVM-009 AC4; ADR-0015: the report names the emulator API level and the Maestro version) and the
 * check of the logcat of the app process for addresses and secrets (SR-LOG-08).
 */

/**
 * @param {string} logcat
 * @returns {{ lines: number, withAddress: number, withSecret: number }} counts only — the lines themselves are never reported
 */
export function scanLogcat(logcat) {
  const lines = logcat.split(/\r?\n/).filter((line) => line.trim() !== '');
  return {
    lines: lines.length,
    withAddress: lines.filter((line) => /https?:\/\//i.test(line)).length,
    withSecret: lines.filter((line) => /authorization|bearer|password|secret|token/i.test(line)).length,
  };
}

/**
 * @typedef {{
 *   scenario: string,
 *   flow: string,
 *   status: 'passed' | 'failed' | 'skipped',
 *   seconds: number,
 *   attempts?: 1 | 2,
 *   checks?: import('./device.mjs').Check[],
 * }} Result
 * @typedef {{
 *   date: string,
 *   device: { serial: string, apiLevel: string, androidRelease: string, model: string, buildType?: string },
 *   maestroVersion: string,
 *   appVersion: string,
 *   results: Result[],
 *   requests: { platform: string | undefined, version: string | undefined }[],
 *   logcat: { lines: number, withAddress: number, withSecret: number } | null,
 *   screenshots?: string[],
 * }} Evidence
 */

/** @param {Evidence} evidence */
export function buildReport(evidence) {
  const passed = evidence.results.filter((result) => result.status === 'passed').length;
  const failed = evidence.results.filter((result) => result.status === 'failed').length;
  const headersSent =
    evidence.requests.length > 0 && evidence.requests.every((request) => request.platform === 'android' && request.version !== undefined);
  const rows = evidence.results.map(
    (result) =>
      `| ${result.scenario} | ${result.flow} | ${result.status}${result.attempts === 2 ? ' (retried)' : ''} | ${result.seconds.toFixed(1)} |`,
  );
  const screenshots = evidence.screenshots ?? [];
  const retried = evidence.results.filter((result) => result.attempts === 2).map((result) => result.flow);
  return [
    `# Maestro smoke test — ${evidence.date}`,
    '',
    `- Emulator: ${evidence.device.model}, Android ${evidence.device.androidRelease} (API ${evidence.device.apiLevel}), ${evidence.device.serial}` +
      (evidence.device.buildType === undefined || evidence.device.buildType === ''
        ? ''
        : `, ${evidence.device.buildType} build (${evidence.device.buildType === 'user' ? 'Google Play image, no adb root' : 'adb root possible'})`),
    `- Maestro: ${evidence.maestroVersion}`,
    `- Application version in the build: ${evidence.appVersion}`,
    `- Result: ${String(passed)} passed, ${String(failed)} failed, ${String(evidence.results.length - passed - failed)} skipped`,
    `- Retried flows: ${retried.length === 0 ? 'none' : retried.join(', ')}`,
    `- Requests that reached the scenario server: ${String(evidence.requests.length)}; X-Client-Platform=android and X-Client-Version on every request: ${headersSent ? 'yes' : 'NO'}`,
    evidence.logcat === null
      ? '- Logcat of the app process: not collected'
      : `- Logcat of the app process: ${String(evidence.logcat.lines)} lines, ${String(evidence.logcat.withAddress)} with an address, ${String(evidence.logcat.withSecret)} with a secret-like word`,
    `- Screenshots for the UX review: ${screenshots.length === 0 ? 'none' : `${String(screenshots.length)} (${screenshots.join(', ')})`}`,
    '',
    '| Scenario | Flow | Status | Seconds |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    ...deviceStepRows(evidence.results),
  ].join('\n');
}

/**
 * The device steps of EVM-093 (adb run-as, backup, restart) with their verdicts: counts and codes only.
 * @param {Result[]} results
 * @returns {string[]}
 */
function deviceStepRows(results) {
  const rows = results.flatMap((result) =>
    (result.checks ?? []).map((check) => `| ${result.flow} | ${check.action} | ${check.ok ? 'ok' : 'FAILED'} | ${check.detail} |`),
  );
  return rows.length === 0 ? [] : ['| Flow | Device step | Result | Detail |', '| --- | --- | --- | --- |', ...rows, ''];
}

/** @param {Evidence} evidence @returns {boolean} true when every flow passed and the compatibility headers were sent */
export function isGreen(evidence) {
  const flowsPassed = evidence.results.length > 0 && evidence.results.every((result) => result.status === 'passed');
  const headersSent =
    evidence.requests.length > 0 && evidence.requests.every((request) => request.platform === 'android' && request.version !== undefined);
  const cleanLog = evidence.logcat === null || (evidence.logcat.withAddress === 0 && evidence.logcat.withSecret === 0);
  return flowsPassed && headersSent && cleanLog;
}
