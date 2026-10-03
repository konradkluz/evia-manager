// @ts-check
/**
 * Location patterns from docs/process/document-lifecycle.md → „Dozwolone lokalizacje”.
 * Own matcher on purpose (no experimental `path.matchesGlob` / `fs.glob`):
 * - paths are repository-relative with `/` separators, matching is case-sensitive;
 * - `*` — any characters within one segment;
 * - `**` — any number of segments (also zero); as the last segment: everything below the directory;
 * - placeholders: `<M#>` = M + digits, `<EVM-ID>` = EVM- + at least 3 digits, `<NNNN>` = 4 digits,
 *   `<nazwa>` = one segment; their values are returned as captures.
 */
import { ToolError } from './errors.mjs';

/** @type {ReadonlyMap<string, { group: string, regex: string }>} */
const PLACEHOLDERS = new Map([
  ['<M#>', { group: 'milestone', regex: 'M\\d+' }],
  ['<EVM-ID>', { group: 'evmId', regex: 'EVM-\\d{3,}' }],
  ['<NNNN>', { group: 'number', regex: '\\d{4}' }],
  ['<nazwa>', { group: 'name', regex: '[^/]+' }],
]);

/**
 * @typedef {object} CompiledPattern
 * @property {string} source pattern as written in the policy / configuration
 * @property {RegExp} regex anchored regular expression
 * @property {string[]} groups capture names in order of appearance (`milestone`, `evmId`, `number`, `name`)
 */

/** @typedef {{ milestone?: string, evmId?: string, number?: string, name?: string }} PatternCaptures */

/**
 * @param {string} pattern
 * @returns {CompiledPattern}
 */
export function compilePattern(pattern) {
  const invalid = (/** @type {string} */ why) => new ToolError(`niepoprawny wzorzec „${pattern}”: ${why}`);
  if (pattern === '' || pattern.startsWith('/') || pattern.endsWith('/') || pattern.includes('\\')) {
    throw invalid('wymagana ścieżka względna z separatorem / (bez / na początku i na końcu)');
  }
  /** @type {string[]} */
  const groups = [];
  const segments = pattern.split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '') throw invalid('pusty segment ścieżki');
    if (segment === '**') {
      source += last ? '[^/]+(?:/[^/]+)*' : '(?:[^/]+/)*';
      return;
    }
    source += translateSegment(segment, groups, invalid) + (last ? '' : '/');
  });
  if (new Set(groups).size !== groups.length) throw invalid('powtórzony symbol');
  return { source: pattern, regex: new RegExp(`${source}$`, 'u'), groups };
}

/**
 * @param {string} segment
 * @param {string[]} groups collects capture names
 * @param {(why: string) => ToolError} invalid
 * @returns {string}
 */
function translateSegment(segment, groups, invalid) {
  let out = '';
  let index = 0;
  while (index < segment.length) {
    const char = segment[index];
    if (char === '*') {
      out += '[^/]*';
      index += 1;
    } else if (char === '<') {
      // Unterminated `<…` gives slice(index, 0) === '' — not a placeholder either.
      const end = segment.indexOf('>', index);
      const placeholder = PLACEHOLDERS.get(segment.slice(index, end + 1));
      if (placeholder === undefined) throw invalid(`nieznany symbol ${segment.slice(index)}`);
      groups.push(placeholder.group);
      out += `(?<${placeholder.group}>${placeholder.regex})`;
      index = end + 1;
    } else {
      out += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      index += 1;
    }
  }
  return out;
}

/**
 * @param {CompiledPattern} pattern
 * @param {string} path repository-relative path with `/`
 * @returns {PatternCaptures | null} captures when the path matches, otherwise null
 */
export function matchPattern(pattern, path) {
  const match = pattern.regex.exec(path);
  return match ? { ...match.groups } : null;
}
