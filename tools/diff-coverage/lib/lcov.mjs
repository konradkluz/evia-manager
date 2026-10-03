// @ts-check
/** lcov parsing and merging (EVM-006 AC3). Only `SF`, `DA` and `BRDA` records matter for changed-code coverage. */

/**
 * @typedef {object} LcovRecord
 * @property {string} source path exactly as written in `SF:` (relative or absolute, any separator)
 * @property {Map<number, number>} lines line → hit count
 * @property {Map<string, number>} branches `line:block:branch` → taken count (`-` = 0)
 */

/**
 * @typedef {object} FileCoverage
 * @property {Map<number, number>} lines
 * @property {Map<string, number>} branches
 */

/**
 * @param {string} text
 * @returns {LcovRecord[]}
 */
export function parseLcov(text) {
  /** @type {LcovRecord[]} */
  const records = [];
  /** @type {LcovRecord | null} */
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = { source: line.slice(3), lines: new Map(), branches: new Map() };
    } else if (line === 'end_of_record') {
      if (current) records.push(current);
      current = null;
    } else if (current && line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',');
      current.lines.set(Number(lineNo), Number(hits));
    } else if (current && line.startsWith('BRDA:')) {
      const [lineNo, block, branch, taken] = line.slice(5).split(',');
      current.branches.set(`${String(lineNo)}:${String(block)}:${String(branch)}`, taken === '-' ? 0 : Number(taken));
    }
  }
  return records;
}

/**
 * Merges coverage of the same repository file from several reports by the maximum hit count.
 * @param {Array<FileCoverage & { file: string }>} entries
 * @returns {Map<string, FileCoverage>}
 */
export function mergeCoverage(entries) {
  /** @type {Map<string, FileCoverage>} */
  const merged = new Map();
  for (const entry of entries) {
    /** @type {FileCoverage} */
    const target = merged.get(entry.file) ?? { lines: new Map(), branches: new Map() };
    for (const [line, hits] of entry.lines) target.lines.set(line, Math.max(hits, target.lines.get(line) ?? 0));
    for (const [key, taken] of entry.branches) target.branches.set(key, Math.max(taken, target.branches.get(key) ?? 0));
    merged.set(entry.file, target);
  }
  return merged;
}
