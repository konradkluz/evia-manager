// @ts-check
/**
 * References between documents — the basis of the „osierocony” warning (finding E).
 * A reference is a Markdown link or a `.md` path written in text (also in `code`), resolved
 * relative to the referring document's directory or to the repository root, and only
 * against the in-memory set of paths from git: nothing found in a document is ever opened
 * or checked on disk, so the result is the same on Windows and Linux.
 * A heuristic on purpose — that is why „osierocony” is only a warning.
 */
import { posix } from 'node:path';
import { compareCodeUnits } from './text.mjs';

/** Maximal run of path characters (letters with `u` flag, so Polish names work). */
const PATH_RUN = /[\p{L}\p{N}\p{M}._~%+@/-]+/gu;

/** Split point inside a run: between two consecutive slashes (a path has no empty segment). */
const DOUBLE_SLASH = /(?<=\/)(?=\/)/;

/** A character that may not follow `.md` (`plik.mdx`, `a.md-b`); checked at one position only. */
const NAME_CHAR = /^[\p{L}\p{N}\p{M}_-]/u;

const SUFFIX = '.md';

/**
 * Path-like tokens ending with `.md`: `/?` + non-empty segments separated by single `/`, the last
 * one ending with `.md` not followed by a name character. Linear time — no backtracking regex:
 * a token never crosses a non-path character or `//`, so within such a chunk it starts at the
 * chunk's beginning and ends after the last valid `.md` (the longest match, as a greedy pattern
 * would give).
 * @param {string} text normalised document text
 * @returns {string[]} path tokens in order of appearance
 */
export function extractPathTokens(text) {
  /** @type {string[]} */
  const tokens = [];
  for (const [run] of text.matchAll(PATH_RUN)) {
    if (!run.includes(SUFFIX)) continue;
    for (const chunk of run.split(DOUBLE_SLASH)) {
      const end = lastTokenEnd(chunk);
      if (end > 0) tokens.push(chunk.slice(0, end));
    }
  }
  return tokens;
}

/**
 * @param {string} chunk path characters without `//`
 * @returns {number} end of the last `.md` not followed by a name character, 0 when none
 */
function lastTokenEnd(chunk) {
  let at = chunk.lastIndexOf(SUFFIX);
  while (at >= 0) {
    const end = at + SUFFIX.length;
    if (!NAME_CHAR.test(chunk.slice(end, end + 2))) return end;
    at = at === 0 ? -1 : chunk.lastIndexOf(SUFFIX, at - 1);
  }
  return 0;
}

/**
 * @param {string} token
 * @returns {string}
 */
function decode(token) {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

/**
 * Repository paths a token may point to (NFC); `/…` = from the root, otherwise relative to the
 * document's directory or to the root. Paths leaving the repository are dropped.
 * @param {string} source referring document
 * @param {string} token
 * @returns {string[]}
 */
export function referenceCandidates(source, token) {
  const target = decode(token).normalize('NFC');
  const raw = target.startsWith('/') ? [target.slice(1)] : [posix.join(posix.dirname(source.normalize('NFC')), target), target];
  const candidates = raw.map((path) => posix.normalize(path)).filter((path) => path !== '..' && !path.startsWith('../'));
  return [...new Set(candidates)];
}

/**
 * @param {string[]} markdown `.md` paths of the checked set
 * @param {(path: string) => string} textOf
 * @returns {Map<string, string[]>} target → documents referring to it (sorted, without self-references)
 */
export function buildReferenceIndex(markdown, textOf) {
  const byKey = new Map(markdown.map((path) => [path.normalize('NFC'), path]));
  /** @type {Map<string, Set<string>>} */
  const index = new Map();
  for (const source of markdown) {
    for (const token of extractPathTokens(textOf(source))) {
      for (const candidate of referenceCandidates(source, token)) {
        const target = byKey.get(candidate);
        if (target === undefined || target === source) continue;
        const sources = index.get(target) ?? new Set();
        sources.add(source);
        index.set(target, sources);
      }
    }
  }
  return new Map(Array.from(index, ([target, sources]) => [target, [...sources].sort(compareCodeUnits)]));
}
