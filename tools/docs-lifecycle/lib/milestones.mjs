// @ts-check
/**
 * List of milestones (finding E): rows of the „Przegląd” table in the roadmap
 * (robust to `**M0**`) ∪ `docs/backlog/<M#>/` directories from the git file list.
 */
import { matchPattern } from './patterns.mjs';
import { compareCodeUnits } from './text.mjs';

const MILESTONE_ID = /^M\d+$/;
/** `#`–`######`, a blank and text without a line break (EVM-013 L3: one quantifier — linear time). */
const HEADING = /^#{1,6}[ \t]([^\n\r\u2028\u2029]*)$/;
const TABLE_FIRST_CELL = /^[ \t]*\|([^|]*)\|/;

/**
 * @param {string} value
 * @returns {boolean} `M` followed by digits
 */
export function isMilestoneId(value) {
  return MILESTONE_ID.test(value);
}

/**
 * Numeric order (M2 before M10); ties (M1 / M01) by code units.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareMilestones(a, b) {
  return Number(a.slice(1)) - Number(b.slice(1)) || compareCodeUnits(a, b);
}

/** @param {string | undefined} char */
const isBlank = (char) => char === ' ' || char === '\t';

/**
 * Heading text without the blanks around it; the blanks are trimmed by loops, not by a pattern (EVM-013 L3: the
 * former pattern was cubic for blanks before U+2028).
 * @param {string} line
 * @returns {string | null} heading text or null when the line is not a heading
 */
export function headingText(line) {
  const match = HEADING.exec(line);
  if (!match) return null;
  const text = match[1];
  let start = 0;
  let end = text.length;
  while (start < end && isBlank(text[start])) start += 1;
  while (end > start && isBlank(text[end - 1])) end -= 1;
  if (start < end) return text.slice(start, end);
  // Only blanks after `#`: the former pattern needed a second blank and took the last one as the text.
  return text === '' ? null : text.slice(-1);
}

/**
 * Milestones from the first column of table rows in the given roadmap section.
 * @param {string} text roadmap content (LF line endings)
 * @param {string} section heading text, e.g. `Przegląd`
 * @returns {string[]}
 */
export function parseRoadmapMilestones(text, section) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => headingText(line) === section);
  /** @type {string[]} */
  const found = [];
  if (start === -1) return found;
  for (const line of lines.slice(start + 1)) {
    if (headingText(line) !== null) break;
    const cell = TABLE_FIRST_CELL.exec(line);
    const value = cell ? cell[1].replace(/[*_`\s]/g, '') : '';
    if (isMilestoneId(value)) found.push(value);
  }
  return found;
}

/**
 * @param {string[]} paths all files visible to git
 * @param {string} roadmapText
 * @param {import('./config.mjs').Config} config
 * @returns {string[]} sorted, unique
 */
export function collectMilestones(paths, roadmapText, config) {
  const found = new Set(parseRoadmapMilestones(roadmapText, config.roadmap.section));
  for (const path of paths) {
    const captures = matchPattern(config.milestoneDirPattern, path);
    if (captures) found.add(String(captures.milestone));
  }
  return [...found].sort(compareMilestones);
}
