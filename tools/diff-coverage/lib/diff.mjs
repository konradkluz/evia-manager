// @ts-check
/**
 * Parsing of `git diff` (EVM-006 AC3): added and changed lines of the new version, per file (`-U0` patch), and the
 * `--numstat -z` cross-check that keeps the gate fail-closed when a changed file escapes the patch parser.
 */

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t(.*)$/su;
/** A C-quoted name of quote.c (`"…"`); escapes are `\` + one character or three octal digits. */
const QUOTED = /^"((?:[^"\\]|\\.)*)"$/su;
const ESCAPE = /\\([0-3][0-7]{2}|.)|([^\\]+)/gsu;
/** Single-character escapes of git's quote_c_style. */
const ESCAPES = new Map([
  ['a', 7],
  ['b', 8],
  ['t', 9],
  ['n', 10],
  ['v', 11],
  ['f', 12],
  ['r', 13],
  ['"', 34],
  ['\\', 92],
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {string} text output of `git -c core.quotePath=false diff -U0 --no-color --src-prefix=a/ --dst-prefix=b/ …`
 * @returns {Map<string, number[]>} repository path → changed line numbers (ascending); deleted files are skipped
 */
export function parseUnifiedDiff(text) {
  /** @type {Map<string, number[]>} */
  const changed = new Map();
  /** @type {string | null} */
  let file = null;
  // Lines still expected in the current hunk: inside a hunk every line is content — an added line "++ x" is printed
  // as "+++ x" and must never be read as a file header.
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (oldLeft > 0 && line.startsWith('-')) {
      oldLeft -= 1;
    } else if (newLeft > 0 && line.startsWith('+')) {
      newLeft -= 1;
    } else if ((oldLeft > 0 || newLeft > 0) && line.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      oldLeft = 0;
      newLeft = 0;
      if (line.startsWith('diff --git ')) {
        file = null;
      } else if (line.startsWith('+++ ')) {
        file = headerPath(line.slice(4));
      } else {
        const hunk = HUNK.exec(line);
        if (hunk) {
          oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
          const start = Number(hunk[2]);
          newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
          if (file !== null && newLeft > 0) {
            const lines = changed.get(file) ?? [];
            for (let offset = 0; offset < newLeft; offset += 1) lines.push(start + offset);
            changed.set(file, lines);
          }
        }
      }
    }
  }
  return changed;
}

/**
 * Path of a `+++ ` header. Git appends a TAB when the name contains a space, and C-quotes the whole name (prefix
 * included) when it contains `"`, `\` or a control character — also with core.quotePath=false.
 * @param {string} header text after `+++ `
 * @returns {string | null} repository path; null for /dev/null (deleted file) and for anything unexpected
 */
export function headerPath(header) {
  const name = header.endsWith('\t') ? header.slice(0, -1) : header;
  const path = name.startsWith('"') ? unquote(name) : name;
  return path !== null && path.startsWith('b/') ? path.slice(2) : null;
}

/**
 * @param {string} quoted `"…"` with C escapes; octal escapes are bytes of UTF-8
 * @returns {string | null} null when the quoting is malformed
 */
function unquote(quoted) {
  const body = QUOTED.exec(quoted)?.[1];
  if (body === undefined) return null;
  /** @type {number[]} */
  const bytes = [];
  for (const [, escape, plain] of body.matchAll(ESCAPE)) {
    if (plain !== undefined) {
      bytes.push(...encoder.encode(plain));
    } else {
      const code = /** @type {string} */ (escape);
      const byte = code.length === 3 ? Number.parseInt(code, 8) : ESCAPES.get(code);
      if (byte === undefined) return null;
      bytes.push(byte);
    }
  }
  return decoder.decode(Uint8Array.from(bytes));
}

/**
 * @param {string} text output of `git diff --numstat -z …` (paths verbatim, never quoted)
 * @returns {Map<string, number | null>} new path → added lines; null for a binary file
 * @throws {SyntaxError} on an entry that is not `added TAB deleted TAB path` — never guess (fail closed)
 */
export function parseNumstat(text) {
  /** @type {Map<string, number | null>} */
  const added = new Map();
  const tokens = text.split('\0').reverse();
  for (let token = tokens.pop(); token !== undefined; token = tokens.pop()) {
    if (token === '' && tokens.length === 0) break;
    const entry = NUMSTAT.exec(token);
    let path = entry?.[3];
    // A rename: "added TAB deleted TAB" NUL old path NUL new path NUL.
    if (path === '') {
      tokens.pop();
      path = tokens.pop();
    }
    if (entry === null || path === undefined || path === '') throw new SyntaxError(`nieczytelny wpis git diff --numstat: ${token}`);
    added.set(path, entry[1] === '-' ? null : Number(entry[1]));
  }
  return added;
}

/**
 * Files whose added lines the patch parser did not account for exactly: a count different from `--numstat`, a binary
 * file (`-`, e.g. `-diff` in .gitattributes) or a patch path unknown to `--numstat`.
 * @param {Map<string, number[]>} changed result of parseUnifiedDiff
 * @param {Map<string, number | null>} added result of parseNumstat for the same range and options
 * @returns {string[]} repository paths
 */
export function unaccounted(changed, added) {
  const paths = new Set([...added.keys(), ...changed.keys()]);
  return [...paths].filter((path) => (added.get(path) ?? -1) !== (changed.get(path)?.length ?? 0)).sort();
}
