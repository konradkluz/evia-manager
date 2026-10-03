// @ts-check
/**
 * Cleanup report for a milestone (AC5, AC6) — a read-only proposal; Konrad decides in `/milestone close`.
 * Fail-safe (finding H): „usuń” only for a correctly classified „kamień milowy” file (or spike directory)
 * of the requested M#; permanent and living files and files with errors get at most „przejrzyj”.
 * „archiwizuj” is never proposed (archive = git history, decision of 2026-10-02) and „zostaw” is
 * Konrad's decision, not a proposal of the tool.
 */
import { CLASS_LABELS } from './analyze.mjs';
import { compareCodeUnits } from './text.mjs';

/** Dictionary of actions (policy → „Raport sprzątania — proponowane akcje”). */
export const ACTIONS = Object.freeze({ remove: 'usuń', archive: 'archiwizuj', review: 'przejrzyj', keep: 'zostaw' });

const MAX_LISTED_REFERENCES = 5;

/**
 * @typedef {object} CleanupItem
 * @property {string} path file or spike directory (`spikes/<nazwa>/`)
 * @property {string | null} class lifecycle class
 * @property {string} action `usuń` or `przejrzyj`
 * @property {string} reason
 */

/**
 * @typedef {object} CleanupReport
 * @property {string} target M#
 * @property {string} today
 * @property {number} fileCount number of `.md` files checked
 * @property {number} errorCount validation errors (the report warns about them first)
 * @property {CleanupItem[]} items „usuń” first, then by path
 */

/**
 * @typedef {object} Candidate
 * @property {string | null} class
 * @property {string | null} milestone valid M# (milestone class only)
 * @property {boolean} hasErrors any validation error of the file / directory
 * @property {boolean} expired
 * @property {boolean} orphan
 */

/**
 * The single decision point of the report (finding H).
 * @param {Candidate} candidate
 * @param {string} target M#
 * @returns {string | null} `usuń`, `przejrzyj` or null (not part of the report)
 */
export function proposeAction({ class: cls, milestone, hasErrors, expired, orphan }, target) {
  const assigned = cls === 'milestone' && milestone === target;
  if (assigned && !hasErrors) return ACTIONS.remove;
  if (assigned || expired || orphan) return ACTIONS.review;
  return null;
}

/**
 * @param {string[]} sources documents referring to the item
 * @returns {string}
 */
function referencesText(sources) {
  if (sources.length === 0) return 'odwołania: brak';
  const listed = sources.slice(0, MAX_LISTED_REFERENCES).join(', ');
  const more = sources.length - MAX_LISTED_REFERENCES;
  return `odwołania: ${listed}${more > 0 ? ` i ${more} inne` : ''} — do poprawienia po usunięciu`;
}

/**
 * @param {Candidate & { action: string, source: string | null, expiredDates: string[], errorCodes: string[], references: string[], subject: string }} item
 * @param {string} target
 * @returns {string}
 */
function reasonFor(item, target) {
  /** @type {string[]} */
  const parts = [];
  if (item.class === 'milestone' && item.milestone !== null) {
    const assignment = `${item.subject}kamień milowy ${item.milestone} (${item.source})`;
    if (item.milestone !== target) parts.push(`${assignment} — nie dotyczy ${target}`);
    else if (item.action === ACTIONS.remove) parts.push(`${assignment}; ${referencesText(item.references)}`);
    else parts.push(assignment);
  }
  if (item.hasErrors) {
    parts.push(`błędy walidacji (${item.errorCodes.join(', ')}) — popraw je przed decyzją (npm run docs:check)`);
  }
  for (const date of item.expiredDates) parts.push(`przeterminowany: ${date}`);
  if (item.orphan) parts.push('osierocony — żaden inny plik .md się do niego nie odwołuje');
  if (item.class === 'permanent' || item.class === 'living') {
    parts.push(`dokument ${CLASS_LABELS[item.class]} — przegląd aktualności, nie usunięcie`);
  }
  return parts.join('; ');
}

/**
 * @param {import('./analyze.mjs').Analysis} analysis
 * @param {string} target M# (validated by the caller against `analysis.milestones`)
 * @returns {CleanupReport}
 */
export function buildCleanupReport(analysis, target) {
  /** @type {Map<string, string[]>} */
  const errorsByPath = new Map();
  for (const finding of analysis.findings) {
    if (finding.severity !== 'error') continue;
    errorsByPath.set(finding.path, [...(errorsByPath.get(finding.path) ?? []), finding.code]);
  }
  /** @type {CleanupItem[]} */
  const items = [];
  /**
   * @param {string} path
   * @param {Candidate & { source: string | null, expiredDates: string[], errorCodes: string[], references: string[], subject: string }} candidate
   */
  const consider = (path, candidate) => {
    const action = proposeAction(candidate, target);
    if (action === null) return;
    items.push({ path, class: candidate.class, action, reason: reasonFor({ ...candidate, action }, target) });
  };

  for (const spike of analysis.spikes.values()) {
    const records = analysis.files.filter((record) => record.spikeDir === spike.dir);
    const errorCodes = [spike.dir, ...spike.files].flatMap((path) => errorsByPath.get(path) ?? []);
    const references = records
      .flatMap((record) => analysis.references.get(record.path) ?? [])
      .filter((source) => !source.startsWith(spike.dir));
    consider(spike.dir, {
      class: 'milestone',
      milestone: spike.milestone,
      hasErrors: errorCodes.length > 0,
      expired: records.some((record) => record.expired.length > 0),
      orphan: false,
      source: `pole milestone w ${spike.dir}README.md`,
      expiredDates: records.flatMap((record) => record.expired.map((date) => `${record.path}: ${date}`)),
      errorCodes,
      references: [...new Set(references)].sort(compareCodeUnits),
      subject: `katalog spike'a (plików: ${spike.files.length}), `,
    });
  }

  for (const record of analysis.files) {
    if (record.spikeDir !== null) continue;
    const errorCodes = errorsByPath.get(record.path) ?? [];
    consider(record.path, {
      class: record.class,
      milestone: record.milestone,
      hasErrors: errorCodes.length > 0,
      expired: record.expired.length > 0,
      orphan: record.orphan,
      source: record.milestoneSource,
      expiredDates: record.expired,
      errorCodes,
      references: analysis.references.get(record.path) ?? [],
      subject: '',
    });
  }

  items.sort(
    (a, b) => Number(a.action !== ACTIONS.remove) - Number(b.action !== ACTIONS.remove) || compareCodeUnits(a.path, b.path),
  );
  return { target, today: analysis.today, fileCount: analysis.files.length, errorCount: analysis.errorCount, items };
}
