// @ts-check
/**
 * Verification of the built APK in the CI job mobile-apk (EVM-009 AC5, AC6): the manifest and the XML resources decoded from the
 * finished package by Google's apkanalyzer, and the contents scanned for secrets. The reads go through `host.run`, so the sequence
 * is tested with the recorded output of a real package (test/fixtures). Processes get an array of arguments, never a shell.
 */
import { join } from 'node:path';
import { isScannable, checkFileList, scanText, PLACEHOLDER_API_HOST } from './contents.mjs';
import { checkManifest } from './manifest.mjs';
import { checkBackupRules, checkDataExtractionRules, checkNetworkSecurityConfig } from './resources.mjs';

/** Resource names written by the hardening plugin of the app (apps/mobile/plugins/with-hardening.ts). */
const RESOURCES = /** @type {const} */ ([
  ['evia_network_security_config', checkNetworkSecurityConfig],
  ['evia_backup_rules', checkBackupRules],
  ['evia_data_extraction_rules', checkDataExtractionRules],
]);

/** The resource of the e2e variant that turns FLAG_SECURE off (apps/mobile/plugins/with-hardening.ts `SCREENSHOTS_RESOURCE`). */
export const SCREENSHOTS_RESOURCE = 'evia_screenshots_allowed';

/** @typedef {{ status: number | null, stdout: string }} Outcome */
/** @typedef {{ run: (command: string, args: string[], options?: { binary?: boolean }) => Outcome }} Host */

/**
 * apkanalyzer as the launcher of cmdline-tools starts it: java with the tool's class path (no .bat, no shell).
 * @param {{ java: string, cmdlineTools: string, args: string[] }} options
 */
export function apkanalyzerCommand({ java, cmdlineTools, args }) {
  return {
    command: java,
    args: [
      `-Dcom.android.sdklib.toolsdir=${cmdlineTools}`,
      '-classpath',
      join(cmdlineTools, 'lib', 'apkanalyzer-classpath.jar'),
      'com.android.tools.apk.analyzer.ApkAnalyzerCli',
      ...args,
    ],
  };
}

/**
 * @param {{ apk: string, applicationId: string, java: string, cmdlineTools: string }} options
 * @param {Host} host
 * @returns {{ problems: string[], notes: string[], placeholderApi: boolean }} placeholderApi: the bundle holds the stand-in API address
 */
export function verifyApk({ apk, applicationId, java, cmdlineTools }, host) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const notes = [];
  let placeholderApi = false;
  /**
   * @param {string[]} args
   * @param {string} what
   * @param {{ binary?: boolean }} [options]
   * @returns {string | null}
   */
  const analyzer = (args, what, options) => {
    const command = apkanalyzerCommand({ java, cmdlineTools, args });
    const outcome = host.run(command.command, command.args, options);
    if (outcome.status === 0) return outcome.stdout;
    problems.push(`apkanalyzer failed: ${what}`);
    return null;
  };

  const manifest = analyzer(['manifest', 'print', apk], 'manifest print');
  if (manifest !== null) problems.push(...guarded('manifest', () => checkManifest(manifest, { applicationId })));

  for (const [name, check] of RESOURCES) {
    const path = analyzer(['resources', 'value', '--config', 'default', '--type', 'xml', '--name', name, apk], `resource ${name}`)?.trim();
    if (path === undefined || path === '') {
      if (path === '') problems.push(`resource ${name} is not in the package`);
      continue;
    }
    const xml = analyzer(['resources', 'xml', '--file', path, apk], `xml ${name}`);
    if (xml !== null) problems.push(...guarded(name, () => check(xml)));
  }

  // EVM-100 (SR-MOB-08, decision 5): only the e2e variant writes this resource; MainActivity keeps FLAG_SECURE without it (fail closed)
  // a missing resource makes apkanalyzer fail: that is the expected answer of a release package, not a finding
  const query = apkanalyzerCommand({
    java,
    cmdlineTools,
    args: ['resources', 'value', '--config', 'default', '--type', 'bool', '--name', SCREENSHOTS_RESOURCE, apk],
  });
  const screenshots = host.run(query.command, query.args);
  if (screenshots.status === 0 && screenshots.stdout.trim() !== 'false') {
    problems.push(`resource ${SCREENSHOTS_RESOURCE} is in the package (screenshots allowed, FLAG_SECURE off — an e2e build)`);
  }

  const listing = analyzer(['files', 'list', apk], 'files list');
  if (listing !== null) {
    const paths = listing.split(/\r?\n/).filter((line) => line.trim() !== '');
    problems.push(...checkFileList(paths));
    for (const path of paths.filter(isScannable)) {
      const content = analyzer(['files', 'cat', '--file', path.replace(/^\//, ''), apk], `cat ${path}`, { binary: true });
      if (content === null) continue;
      problems.push(...scanText(path, content));
      if (content.includes(PLACEHOLDER_API_HOST)) placeholderApi = true;
    }
  }

  const summary = analyzer(['apk', 'summary', apk], 'apk summary')?.trim();
  if (summary !== undefined) {
    const [id, versionCode, versionName] = summary.split('\t');
    notes.push(`application id ${id ?? '?'}, versionCode ${versionCode ?? '?'}, versionName ${versionName ?? '?'}`);
    if (id !== applicationId) problems.push(`application id of the package is not ${applicationId}`);
  }
  if (placeholderApi) notes.push('API address is the placeholder of CI (not for distribution)');
  return { problems, notes, placeholderApi };
}

/**
 * A parser failure is a finding, not a crash of the job.
 * @param {string} what
 * @param {() => string[]} check
 * @returns {string[]}
 */
function guarded(what, check) {
  try {
    return check().map((problem) => `${what}: ${problem}`);
  } catch (error) {
    return [`${what}: unreadable (${error instanceof Error ? error.message : 'error'})`];
  }
}
