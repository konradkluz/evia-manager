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
 * Value from a document, quoted Polish-style and shortened (output carries metadata, not content).
 * @param {string} value
 * @param {number} [max] maximum number of characters
 * @returns {string}
 */
export function quote(value, max = 60) {
  const chars = Array.from(value);
  return `„${chars.length > max ? `${chars.slice(0, max).join('')}…` : value}”`;
}
