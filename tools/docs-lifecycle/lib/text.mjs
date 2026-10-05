// @ts-check
/** Small text helpers shared by the analysis and the output. */

/**
 * Deterministic order by UTF-16 code units — never `localeCompare`
 * (ICU differs between Node versions, finding I).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Markdown file in the policy's scope (`.md`, any letter case — `X.MD` is classified too).
 * @param {string} path
 * @returns {boolean}
 */
export function isMarkdown(path) {
  return /\.md$/i.test(path);
}

const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Escapes control and invisible formatting characters (e.g. bidi overrides) so that
 * paths and values cannot break or disguise the output (finding I).
 * @param {string} text
 * @returns {string}
 */
export function escapeText(text) {
  return text.replace(CONTROL, (char) => `\\u{${Number(char.codePointAt(0)).toString(16).toUpperCase()}}`);
}

/**
 * Prefix of a workflow command of the GitHub Actions runner in format V1 (two hashes and an opening bracket) —
 * recognised anywhere in a line (`IndexOf`).
 */
const RUNNER_V1 = /#(?=#\[)/g;
/** Prefix of a workflow command in format V2 (two colons) — recognised at the start of a line after blanks (`TrimStart()`). */
const RUNNER_V2 = /^(\s*):(?=:)/;

/**
 * One line of output that the runner never takes for a workflow command (EVM-013 L1, L2, W1; CWE-117, CWE-74):
 * control and invisible characters escaped (one physical line), then every V1 prefix and a V2 prefix at the start of
 * the line (after blanks) neutralised by writing their first character as an escape. After `escapeText` the only
 * blanks left are space separators, all matched by `\s`.
 * @param {string} text
 * @returns {string}
 */
export function safeLine(text) {
  return escapeText(text).replace(RUNNER_V1, '\\u{23}').replace(RUNNER_V2, '$1\\u{3A}');
}

/**
 * Quotes a value for a POSIX shell — `'…'`, every `'` as `'\''` — so a hint with a path can be pasted safely (EVM-013 L4,
 * CWE-78). Combined with `safeLine` it stays valid: escaping never changes `'` or a backslash.
 * @param {string} value
 * @returns {string}
 */
export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Value from a document, quoted Polish-style and shortened (output carries metadata, not content).
 * @param {string} value
 * @param {number} [max] maximum number of characters
 * @returns {string}
 */
export function quote(value, max = 60) {
  const chars = Array.from(value);
  return `„${chars.length > max ? `${chars.slice(0, max).join('')}…` : value}”`;
}
