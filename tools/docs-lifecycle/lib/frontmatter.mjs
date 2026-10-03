// @ts-check
/**
 * Minimal frontmatter reader (finding D): only flat, top-level `key: value` fields are read.
 * - recognised only when the first line (after removing BOM and CRLF → LF) is `---` and a closing `---` exists;
 * - indented lines, list items and multi-line values are ignored (e.g. `description` in `.claude/**`);
 * - values are trimmed, matching quotes removed, YAML comments (` #…`) dropped; empty, `~` and `null` = no field;
 * - an unclosed frontmatter means no metadata. The last occurrence of a key wins.
 */

const FENCE = /^---[ \t]*$/;
const FIELD = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*))?$/;
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
    const match = FIELD.exec(line);
    if (!match) continue;
    const value = cleanValue(match[2] ?? '');
    if (value === null) fields.delete(match[1]);
    else fields.set(match[1], value);
  }
  return fields;
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
