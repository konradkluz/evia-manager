// @ts-check
/**
 * Change detection for ci.yml (EVM-083 AC2, EVM-086 AC1, AC2). Three outputs, each "true" (the job runs) or "false":
 *   heavy       — coverage: false only when every changed file is documentation;
 *   e2e         — e2e-web: false only when every changed file is NOT RELEVANT to the panel E2E;
 *   integration — backend-integration: false only when every changed file is NOT RELEVANT to the API integration tests.
 * Lists are of paths "known as not relevant" (EVM-086 AC1): a new or unknown path runs the tests. Never "not relevant"
 * (they are on no list): packages/**, pnpm-lock.yaml, pnpm-workspace.yaml, .github/**, tools/**, compose*.yaml, root
 * configuration and .claude/**. Fail closed: anything doubtful means "true" for every output.
 */

const DOCS_PREFIX = 'docs/';
const ROOT_MARKDOWN = /^[^/]+\.md$/;
const ZERO_SHA = /^0+$/;
const SHA = /^[0-9a-f]{40}$/;
// eslint-disable-next-line no-control-regex -- control characters make a path untrustworthy (fail closed)
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Not relevant to the panel E2E besides documentation (EVM-086 AC1): the API and the mobile app do not affect the panel. */
export const E2E_NOT_RELEVANT_PREFIXES = Object.freeze(['apps/api/', 'apps/mobile/']);
/** Not relevant to the API integration tests besides documentation (EVM-086 AC1). */
export const INTEGRATION_NOT_RELEVANT_PREFIXES = Object.freeze(['apps/web/', 'apps/mobile/']);

/** @param {string} path */
function wellFormed(path) {
  return path !== '' && !path.includes('..') && !path.includes('\\') && !CONTROL.test(path) && !path.startsWith('/');
}

/** @param {string} path */
export function isDocumentation(path) {
  if (!wellFormed(path)) return false;
  return path.startsWith(DOCS_PREFIX) || ROOT_MARKDOWN.test(path);
}

/** @param {string} path */
export function isNotRelevantToE2e(path) {
  return isDocumentation(path) || (wellFormed(path) && E2E_NOT_RELEVANT_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

/** @param {string} path */
export function isNotRelevantToIntegration(path) {
  return isDocumentation(path) || (wellFormed(path) && INTEGRATION_NOT_RELEVANT_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

/** @param {string} reason @returns {{ heavy: true, e2e: true, integration: true, reason: string }} */
const full = (reason) => ({ heavy: true, e2e: true, integration: true, reason });

/**
 * @param {{ eventName: string, baseSha: string, diff: (base: string) => string }} input
 * @returns {{ heavy: boolean, e2e: boolean, integration: boolean, reason: string }}
 */
export function detect({ eventName, baseSha, diff }) {
  // A push reaching ci.yml's `changes` job is a push to main: the full set always runs there (the deployment verifier
  // trusts that run; a docs-only commit must not hide code that failed e2e/integration on main earlier).
  if (eventName === 'push') return full('push na main — pełny zestaw');
  if (eventName !== 'pull_request') return full(`zdarzenie ${eventName || '?'} — pełny zestaw`);
  if (!SHA.test(baseSha) || ZERO_SHA.test(baseSha)) return full('brak poprawnego commitu bazowego — pełny zestaw');
  let files;
  try {
    files = diff(baseSha)
      .split('\0')
      .filter((file) => file !== '');
  } catch {
    return full('błąd wykrywania zmian — pełny zestaw (fail-closed)');
  }
  if (files.length === 0) return full('pusta lista zmian — pełny zestaw (fail-closed)');
  const heavy = !files.every(isDocumentation);
  const e2e = !files.every(isNotRelevantToE2e);
  const integration = !files.every(isNotRelevantToIntegration);
  const reason = heavy
    ? `${String(files.length)} plików; e2e-web ${e2e ? 'uruchomiony' : 'pominięty (nie dotyczy)'}, backend-integration ${integration ? 'uruchomiona' : 'pominięta (nie dotyczy)'}`
    : `tylko dokumentacja (${String(files.length)} plików) — ciężkie joby pominięte`;
  return { heavy, e2e, integration, reason };
}

/**
 * EVM-007 AC1, AC4: changes that run iac-check and the tests of deploy.sh in a pull request (OpenTofu, the IaC container,
 * the root scripts of the VM and their test image, the compose files and workflows).
 * Fail closed: every other event, a bad base, a diff error or an empty diff mean "true".
 */
export const IAC_PREFIXES = Object.freeze([
  'infra/tofu/',
  'infra/docker/iac/',
  'infra/deploy-agent/',
  'infra/docker/deploy-tests/',
  '.github/',
]);
export const IAC_FILES = Object.freeze(['compose.yaml', 'compose.iac.yaml']);

/**
 * EVM-007 AC2 (ADR-0018 "Publikacja hermetyczna"): build inputs of the release images — `publish` runs for a push to main
 * that changes apps/, packages/, infra/ or the lockfile; the other inputs of the image build (workspace and root
 * configuration, patches, design tokens) count too, so that no input of an image changes without a new image.
 * Documentation alone never publishes. Fail closed for a push: a bad base, a diff error or an empty diff mean "true".
 * Any other event: "false" (`publish` runs for a push to main only).
 */
export const PUBLISH_PREFIXES = Object.freeze(['apps/', 'packages/', 'infra/', 'design/tokens/', 'patches/']);
export const PUBLISH_FILES = Object.freeze(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', '.nvmrc', 'turbo.json']);

/** @param {string} path @param {readonly string[]} prefixes @param {readonly string[]} files */
const matches = (path, prefixes, files) => !wellFormed(path) || files.includes(path) || prefixes.some((prefix) => path.startsWith(prefix));

/** @param {string} path */
export const isIacInput = (path) => matches(path, IAC_PREFIXES, IAC_FILES);
/** @param {string} path */
export const isPublishInput = (path) => matches(path, PUBLISH_PREFIXES, PUBLISH_FILES);

/**
 * @param {{ eventName: string, baseSha: string, diff: (base: string) => string }} input
 * @returns {{ iac: boolean, publish: boolean, reason: string }}
 */
export function detectDeployment({ eventName, baseSha, diff }) {
  const push = eventName === 'push';
  if (!['push', 'pull_request'].includes(eventName)) return { iac: true, publish: false, reason: `zdarzenie ${eventName || '?'}` };
  if (!SHA.test(baseSha) || ZERO_SHA.test(baseSha))
    return { iac: true, publish: push, reason: 'brak poprawnego commitu bazowego (fail-closed)' };
  let files;
  try {
    files = diff(baseSha)
      .split('\0')
      .filter((file) => file !== '');
  } catch {
    return { iac: true, publish: push, reason: 'błąd wykrywania zmian (fail-closed)' };
  }
  if (files.length === 0) return { iac: true, publish: push, reason: 'pusta lista zmian (fail-closed)' };
  const publish = push && files.some(isPublishInput);
  const iac = push || files.some(isIacInput);
  return { iac, publish, reason: `iac-check ${iac ? 'uruchomiony' : 'pominięty'}, publish ${publish ? 'tak' : 'nie'}` };
}
