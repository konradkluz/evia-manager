// @ts-check
/** Test helpers for reading project documents: sections and the policy rules table. */
import { normalizeText } from '../../lib/frontmatter.mjs';

/**
 * Text of a section from its heading (exact line) to the next heading of the same or higher level.
 * @param {string} text
 * @param {string} heading e.g. `## Dokumentacja`
 * @returns {string | null}
 */
export function section(text, heading) {
  const lines = normalizeText(text).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const level = /** @type {RegExpMatchArray} */ (heading.match(/^#+/))[0].length;
  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.indexOf(' ') <= level);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/**
 * @typedef {object} PolicyRule
 * @property {number | null} id
 * @property {string[]} patterns
 * @property {string} class
 * @property {boolean} orphanCheck
 */

/**
 * Rules table under „## Dozwolone lokalizacje”: columns `# | Wzorce | Klasa | Kamień milowy | Osierocony`;
 * patterns = values in backticks of „Wzorce”; class code = the only backticked value of „Klasa”;
 * „tak…” in „Osierocony” = orphan check; row „—” = default rule.
 * @param {string} policy
 * @returns {PolicyRule[]}
 */
export function parsePolicyRules(policy) {
  const lines = String(section(policy, '## Dozwolone lokalizacje')).split('\n');
  const header = lines.findIndex((line) => /^\|\s*#\s*\|\s*Wzorce\s*\|\s*Klasa\s*\|\s*Kamień milowy\s*\|\s*Osierocony\s*\|\s*$/.test(line));
  if (header === -1) throw new Error('brak tabeli reguł w polityce');
  /** @type {PolicyRule[]} */
  const rules = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const backticked = (/** @type {string} */ cell) => Array.from(cell.matchAll(/`([^`]+)`/g), (match) => match[1]);
    const classes = backticked(cells[2]);
    if (classes.length !== 1) throw new Error(`wiersz ${cells[0]}: oczekiwano jednego kodu klasy, jest: ${classes.join(', ')}`);
    rules.push({
      id: cells[0] === '—' ? null : Number(cells[0]),
      patterns: backticked(cells[1]),
      class: classes[0],
      orphanCheck: cells[4].startsWith('tak'),
    });
  }
  return rules;
}
