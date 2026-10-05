// @ts-check
/**
 * Workflow commands of the GitHub Actions runner for the output-safety tests (EVM-013 AC4; security-engineer W1, W2).
 * The prefixes are composed in code: test sources, test titles and assertion messages never contain them, because the
 * test reporter prints titles (and failures) to the CI log, where the runner would act on them.
 */

/** Format V2 — recognised at the start of a line after blanks (`TrimStart()` + `StartsWith`). */
export const V2 = ':'.repeat(2);

/** Format V1 — recognised anywhere in a line (`IndexOf`). */
export const V1 = `${'#'.repeat(2)}[`;

/** Blanks trimmed by .NET `Char.IsWhiteSpace` (the runner's `TrimStart()`) plus everything JS `\s` matches. */
const LEADING_BLANKS = /^[\s\u0085\u180e]*/;

/** Control and invisible characters (the line feed only separates lines). */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * A string as JSON with `#` and `:` escaped — what an assertion may print on failure without a workflow command (W2).
 * Equal strings give equal printable forms and vice versa.
 * @param {string} text
 * @returns {string}
 */
export function printable(text) {
  return JSON.stringify(text).replace(/[#:]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * @param {Record<string, string>} streams e.g. `{ stdout, stderr }`
 * @param {(line: string) => boolean} test
 * @returns {string[]} `stream:line` of the matching lines — never the line itself (W2)
 */
function linesWhere(streams, test) {
  /** @type {string[]} */
  const found = [];
  for (const [name, text] of Object.entries(streams)) {
    text.split('\n').forEach((line, index) => {
      if (test(line)) found.push(`${name}:${index + 1}`);
    });
  }
  return found;
}

/**
 * Lines the runner could take for a workflow command: the V1 prefix anywhere or the V2 prefix at the start after blanks.
 * @param {Record<string, string>} streams
 * @returns {string[]} `stream:line`
 */
export function commandLines(streams) {
  return linesWhere(streams, (line) => line.includes(V1) || line.replace(LEADING_BLANKS, '').startsWith(V2));
}

/**
 * Lines with a control or invisible character other than the line feed.
 * @param {Record<string, string>} streams
 * @returns {string[]} `stream:line`
 */
export function controlLines(streams) {
  return linesWhere(streams, (line) => CONTROL.test(line));
}
