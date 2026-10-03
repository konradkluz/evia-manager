// @ts-check
/** Parsing of `git diff -U0` (EVM-006 AC3): added and changed lines of the new version, per file. */

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * @param {string} text output of `git -c core.quotePath=false diff -U0 --no-color …`
 * @returns {Map<string, number[]>} repository path → changed line numbers (ascending); deleted files are skipped
 */
export function parseUnifiedDiff(text) {
  /** @type {Map<string, number[]>} */
  const changed = new Map();
  /** @type {string | null} */
  let file = null;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      file = null;
    } else if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : null;
    } else if (file !== null) {
      const hunk = HUNK.exec(line);
      if (hunk) {
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        const lines = changed.get(file) ?? [];
        for (let offset = 0; offset < count; offset += 1) lines.push(start + offset);
        if (lines.length > 0) changed.set(file, lines);
      }
    }
  }
  return changed;
}
