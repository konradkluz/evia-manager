// @ts-check
/**
 * Documentation-only detection for ci.yml (EVM-083 AC2). Documentation = everything under docs/ and Markdown files in
 * the repository root. Nothing else (workflows, tools, code, configuration, .claude) is documentation.
 */

const DOCS_PREFIX = 'docs/';
const ROOT_MARKDOWN = /^[^/]+\.md$/;
const ZERO_SHA = /^0+$/;
const SHA = /^[0-9a-f]{40}$/;

/** @param {string} path */
export function isDocumentation(path) {
  if (path.includes('..') || path.includes('\\')) return false;
  return path.startsWith(DOCS_PREFIX) || ROOT_MARKDOWN.test(path);
}

/**
 * @param {{ eventName: string, baseSha: string, diff: (base: string) => string }} input
 * @returns {{ heavy: boolean, reason: string }}
 */
export function detect({ eventName, baseSha, diff }) {
  // A push reaching ci.yml's `changes` job is a push to main: the full set always runs there (the deployment verifier
  // trusts that run; a docs-only commit must not hide code that failed e2e/integration on main earlier).
  if (eventName === 'push') return { heavy: true, reason: 'push na main — pełny zestaw' };
  if (eventName !== 'pull_request') return { heavy: true, reason: `zdarzenie ${eventName || '?'} — pełny zestaw` };
  if (!SHA.test(baseSha) || ZERO_SHA.test(baseSha)) return { heavy: true, reason: 'brak poprawnego commitu bazowego — pełny zestaw' };
  let files;
  try {
    files = diff(baseSha)
      .split('\0')
      .filter((file) => file !== '');
  } catch {
    return { heavy: true, reason: 'błąd wykrywania zmian — pełny zestaw (fail-closed)' };
  }
  if (files.length === 0) return { heavy: true, reason: 'pusta lista zmian — pełny zestaw (fail-closed)' };
  const code = files.filter((file) => !isDocumentation(file));
  if (code.length > 0)
    return { heavy: true, reason: `zmiany poza dokumentacją (${String(code.length)} z ${String(files.length)} plików) — pełny zestaw` };
  return { heavy: false, reason: `tylko dokumentacja (${String(files.length)} plików) — ciężkie joby pominięte` };
}
