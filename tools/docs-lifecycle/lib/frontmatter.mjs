// @ts-check
/**
 * Minimal frontmatter reader (finding D): only flat, top-level `key: value` fields are read.
 * - recognised only when the first line (after removing BOM and CRLF → LF) is `---` and a closing `---` exists;
 * - indented lines, list items and multi-line values are ignored (e.g. `description` in `.claude/**`);
 * - values are trimmed, matching quotes removed, YAML comments (` #…`) dropped; empty, `~` and `null` = no field;
 * - an unclosed frontmatter means no metadata. The last occurrence of a key wins.
 */

const FENCE = /^---[ \t]*$/;
/** Key of a field; the rest of the line is checked in code (EVM-013 L3: no overlapping quantifiers — linear time). */
const KEY = /^([A-Za-z_][\w-]*)[ \t]*:/;
/** Characters that `.` in a regular expression does not match: a value containing one is not a field (as before). */
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const LEADING_BLANKS = /^[ \t]*/;
const QUOTED = /^(["'])(.*)\1(?:[ \t]+#.*)?$/;
const COMMENT = /(?:^|[ \t])#.*$/;
const NULL_VALUE = /^(?:~|null|Null|NULL)?$/;

/**
 * Removes a leading BOM and converts CRLF / CR line endings to LF.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * @param {string} text file content (any line endings)
 * @returns {Map<string, string>} top-level fields
 */
export function parseFrontmatter(text) {
  /** @type {Map<string, string>} */
  const fields = new Map();
  const lines = normalizeText(text).split('\n');
  if (!FENCE.test(lines[0])) return fields;
  const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (end === -1) return fields;
  for (const line of lines.slice(1, end)) {
    const field = fieldOf(line);
    if (field === null) continue;
    const [key, raw] = field;
    const value = cleanValue(raw);
    if (value === null) fields.delete(key);
    else fields.set(key, value);
  }
  return fields;
}

/**
 * One flat `key: value` line in linear time (EVM-013 L3; the former single pattern was quadratic for blanks before
 * U+2028): a key, optional blanks and `:`, then nothing or a blank and a value without a line break.
 * @param {string} line
 * @returns {[string, string] | null} key and raw value (leading blanks removed); null when the line is not a field
 */
export function fieldOf(line) {
  const match = KEY.exec(line);
  if (!match) return null;
  const rest = line.slice(match[0].length);
  if (LINE_BREAK.test(rest)) return null;
  const value = rest.replace(LEADING_BLANKS, '');
  // `key:value` without a blank after the colon is not a field.
  return rest === '' || value !== rest ? [match[1], value] : null;
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function cleanValue(raw) {
  const value = raw.trim();
  const quoted = QUOTED.exec(value);
  if (quoted) return quoted[2];
  const plain = value.replace(COMMENT, '').trim();
  return NULL_VALUE.test(plain) ? null : plain;
}
