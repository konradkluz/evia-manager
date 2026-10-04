// @ts-check
/**
 * Changed-code coverage (EVM-006 AC3, docs/process/testing-strategy.md: ≥ 90% of lines and branches).
 * Fail closed: a changed source file without any coverage report counts as uncovered.
 */
import { matchesGlob } from 'node:path';

const SOURCE_DIRS = /^(apps|packages|services|tools)\//;
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * @param {string} path repository path
 * @param {string[]} exclude glob patterns from packages/config/coverage-exclusions.json
 */
export function isSourceFile(path, exclude) {
  return SOURCE_DIRS.test(path) && SOURCE_EXTENSIONS.test(path) && !exclude.some((pattern) => matchesGlob(path, pattern));
}

/** @typedef {{ total: number, covered: number }} Count */

/**
 * @typedef {object} FileResult
 * @property {string} path
 * @property {boolean} reported a coverage report exists for the file
 * @property {Count} lines
 * @property {Count} branches
 * @property {number[]} uncovered changed lines without hits
 * @property {number[]} uncoveredBranches changed lines with a branch never taken
 */

/**
 * @typedef {object} Evaluation
 * @property {FileResult[]} files
 * @property {Count} lines
 * @property {Count} branches
 * @property {boolean} measurable at least one changed line or branch can be measured
 * @property {boolean} passed
 */

/**
 * @param {Count} count
 * @param {number} threshold
 */
export const meets = (count, threshold) => count.total === 0 || count.covered * 100 >= threshold * count.total;

/**
 * @param {object} input
 * @param {Map<string, number[]>} input.changed repository path → changed lines
 * @param {Map<string, import('./lcov.mjs').FileCoverage>} input.coverage merged coverage per repository path
 * @param {string[]} input.exclude
 * @param {(path: string) => string[] | null} input.readLines lines of a working-tree file, null when unreadable
 * @param {number} input.threshold percent
 * @returns {Evaluation}
 */
export function evaluate({ changed, coverage, exclude, readLines, threshold }) {
  /** @type {FileResult[]} */
  const files = [];
  for (const [path, lines] of changed) {
    if (!isSourceFile(path, exclude)) continue;
    const report = coverage.get(path);
    const result = report ? measured(path, lines, report) : unreported(path, lines, readLines(path));
    if (result.lines.total > 0 || result.branches.total > 0) files.push(result);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const lines = sum(files.map((file) => file.lines));
  const branches = sum(files.map((file) => file.branches));
  return { files, lines, branches, measurable: files.length > 0, passed: meets(lines, threshold) && meets(branches, threshold) };
}

/**
 * @param {string} path
 * @param {number[]} changedLines
 * @param {import('./lcov.mjs').FileCoverage} report
 * @returns {FileResult}
 */
function measured(path, changedLines, report) {
  const changedSet = new Set(changedLines);
  const instrumented = changedLines.filter((line) => report.lines.has(line));
  const uncovered = instrumented.filter((line) => report.lines.get(line) === 0);
  const branchEntries = [...report.branches].filter(([key]) => changedSet.has(Number(key.split(':')[0])));
  const missed = branchEntries.filter(([, taken]) => taken === 0).map(([key]) => Number(key.split(':')[0]));
  return {
    path,
    reported: true,
    lines: { total: instrumented.length, covered: instrumented.length - uncovered.length },
    branches: { total: branchEntries.length, covered: branchEntries.length - missed.length },
    uncovered,
    uncoveredBranches: [...new Set(missed)].sort((a, b) => a - b),
  };
}

/**
 * @param {string} path
 * @param {number[]} changedLines
 * @param {string[] | null} content
 * @returns {FileResult}
 */
function unreported(path, changedLines, content) {
  const uncovered = content === null ? changedLines : changedLines.filter((line) => (content[line - 1] ?? '').trim() !== '');
  return {
    path,
    reported: false,
    lines: { total: uncovered.length, covered: 0 },
    branches: { total: 0, covered: 0 },
    uncovered,
    uncoveredBranches: [],
  };
}

/** @param {Count[]} counts @returns {Count} */
const sum = (counts) =>
  counts.reduce((acc, count) => ({ total: acc.total + count.total, covered: acc.covered + count.covered }), { total: 0, covered: 0 });
