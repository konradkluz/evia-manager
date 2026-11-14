// @ts-check
/**
 * Mapping of lcov `SF:` paths to repository paths (EVM-006 AC3). Reports come from Windows (relative paths with
 * `\`, absolute `C:\…`), from the backend-tests container (`/work/repo/…`) and from CI runners (`/home/runner/…`).
 */
import { posix } from 'node:path';

/**
 * Directories (repository paths) that hold reports outside a workspace: `coverage/backend-tests/` (the backend-tests container
 * copies its reports there, a workspace tree below it) and `coverage/mobile-kotlin/` (EVM-109: the Kotlin engine report, converted
 * from Kover; its `SF:` paths are relative to the repository root, so its workspace is `.`).
 */
export const EXTRA_REPORT_DIRECTORIES = Object.freeze(['coverage/backend-tests/', 'coverage/mobile-kotlin/']);

/** Working copy of the repository inside the backend-tests container (tools/container/sync.mjs). */
const CONTAINER_ROOT = '/work/repo/';

/** @param {string} path */
const slashes = (path) => path.replaceAll('\\', '/');

/**
 * @param {string} reportPath repository path of an `lcov.info` file
 * @returns {string} workspace directory of the report (the directory above `coverage/`)
 */
export function workspaceOfReport(reportPath) {
  const directory = EXTRA_REPORT_DIRECTORIES.find((prefix) => reportPath.startsWith(prefix));
  const path = directory === undefined ? reportPath : reportPath.slice(directory.length);
  return posix.dirname(posix.dirname(path));
}

/**
 * @param {string} source path from `SF:`
 * @param {{ root: string, workspace: string }} context repository root (any separator) and workspace of the report
 * @returns {string | null} repository path, or null when the file is outside the repository
 */
export function normalizeSource(source, { root, workspace }) {
  const path = slashes(source);
  const absolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path);
  if (!absolute) return posix.normalize(posix.join(workspace, path));
  const rootPrefix = `${slashes(root).replace(/\/$/, '')}/`;
  if (path.toLowerCase().startsWith(rootPrefix.toLowerCase())) return path.slice(rootPrefix.length);
  if (path.startsWith(CONTAINER_ROOT)) return path.slice(CONTAINER_ROOT.length);
  const marker = `/${workspace}/`;
  const at = path.lastIndexOf(marker);
  return at >= 0 ? path.slice(at + 1) : null;
}
