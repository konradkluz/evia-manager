// @ts-check
/**
 * GHCR retention (EVM-007 AC2; ADR-0018 "Publikacja hermetyczna" n2; security-engineer A5; architect 20).
 * - Only the packages evia-api and evia-web (never the verifier image or any other package).
 * - Protected: the digests of the release manifests of the last 30 `push` runs of ci.yml on main — a branch can push
 *   versions too, and 20 junk versions must never push out a digest verified on staging (rollback, prod approval).
 * - Kept besides: the 20 newest versions of each package.
 * - Fail-closed: if the manifest of any of those runs cannot be read (a missing, expired or unreadable artifact of a
 *   run whose publish succeeded, an API error), nothing is deleted.
 * - Dry-run by default: deletion only with mode "delete", enabled after the IaC session confirms that GITHUB_TOKEN with
 *   packages: write may delete versions without a PAT (no new secret, AC7). The output has counts and digests only.
 */
import { inflateRawSync } from 'node:zlib';

export const PACKAGES = Object.freeze(['evia-api', 'evia-web']);
export const KEEP_NEWEST = 20;
export const PROTECTED_RUNS = 30;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LIMIT = 1024 * 1024;

export class RetentionError extends Error {}

/**
 * The bytes of release-manifest.json from the artifact ZIP: exactly one entry with that name, store or deflate, at most
 * 1 MiB once inflated. @param {Uint8Array} archive @returns {Uint8Array}
 */
export function manifestFromZip(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.byteLength - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 10, true) !== 1)
    throw new RetentionError('artifact: not a single-entry ZIP');
  const central = view.getUint32(end + 16, true);
  if (central + 46 > end || view.getUint32(central, true) !== 0x02014b50) throw new RetentionError('artifact: central directory');
  const method = view.getUint16(central + 10, true);
  const compressed = view.getUint32(central + 20, true);
  const nameLength = view.getUint16(central + 28, true);
  const local = view.getUint32(central + 42, true);
  const name = new TextDecoder().decode(archive.subarray(central + 46, central + 46 + nameLength));
  if (name !== 'release-manifest.json' || (method !== 0 && method !== 8)) throw new RetentionError('artifact: unexpected entry');
  if (local + 30 > central || view.getUint32(local, true) !== 0x04034b50) throw new RetentionError('artifact: local header');
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  if (start + compressed > central) throw new RetentionError('artifact: data out of bounds');
  const data = archive.subarray(start, start + compressed);
  try {
    return method === 0 ? data : inflateRawSync(data, { maxOutputLength: LIMIT });
  } catch {
    throw new RetentionError('artifact: inflate');
  }
}

/** The image digests of a manifest (repositories of the allowed packages only). @param {Uint8Array} bytes @param {string} owner */
export function digestsOf(bytes, owner) {
  /** @type {unknown} */
  let document;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RetentionError('manifest: not JSON');
  }
  const images = typeof document === 'object' && document !== null ? /** @type {Record<string, unknown>} */ (document)['images'] : null;
  if (typeof images !== 'object' || images === null) throw new RetentionError('manifest: no images');
  return Object.values(images).map((reference) => {
    const [repository = '', digest = ''] = String(reference).split('@');
    if (!PACKAGES.some((name) => repository === `ghcr.io/${owner}/${name}`) || !DIGEST.test(digest))
      throw new RetentionError('manifest: image');
    return digest;
  });
}

/**
 * @typedef {object} Api
 * @property {(path: string) => Promise<unknown>} get JSON of an API path
 * @property {(url: string) => Promise<Uint8Array>} artifact the ZIP of an artifact download URL
 * @property {(path: string) => Promise<void>} remove DELETE of an API path
 */

/** Digests of the manifests of the last PROTECTED_RUNS push runs on main (fail-closed). @param {Api} api @param {string} repository owner/name */
export async function protectedDigests(api, repository) {
  const owner = repository.split('/')[0] ?? '';
  const body = /** @type {{ workflow_runs?: Array<Record<string, unknown>> }} */ (
    await api.get(`/repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=${String(PROTECTED_RUNS)}`)
  );
  if (!Array.isArray(body.workflow_runs)) throw new RetentionError('runs: unexpected answer');
  const runs = body.workflow_runs.filter((run) => run['event'] === 'push' && run['head_branch'] === 'main').slice(0, PROTECTED_RUNS);
  /** @type {Set<string>} */
  const digests = new Set();
  for (const run of runs) {
    const listing = /** @type {{ artifacts?: Array<Record<string, unknown>> }} */ (
      await api.get(`/repos/${repository}/actions/runs/${String(run['id'])}/artifacts?name=release-manifest&per_page=100`)
    );
    if (!Array.isArray(listing.artifacts)) throw new RetentionError('artifacts: unexpected answer');
    const artifacts = listing.artifacts.filter((artifact) => artifact['name'] === 'release-manifest');
    if (artifacts.some((artifact) => artifact['expired'] !== false)) throw new RetentionError(`run ${String(run['id'])}: expired manifest`);
    for (const artifact of artifacts)
      for (const digest of digestsOf(manifestFromZip(await api.artifact(String(artifact['archive_download_url']))), owner))
        digests.add(digest);
  }
  return digests;
}

/**
 * Versions of one package to delete: all but the KEEP_NEWEST newest and the protected digests.
 * @param {Array<{ id: number, name: string, created_at: string }>} versions
 * @param {Set<string>} protectedSet
 */
export function versionsToDelete(versions, protectedSet) {
  const sorted = [...versions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return sorted.slice(KEEP_NEWEST).filter((version) => DIGEST.test(version.name) && !protectedSet.has(version.name));
}

/**
 * One retention run. @param {{ api: Api, repository: string, mode: string, log: (line: string) => void }} input
 * @returns {Promise<{ deleted: number, candidates: number, protected: number, aborted: boolean }>}
 */
export async function retention({ api, repository, mode, log }) {
  const owner = repository.split('/')[0] ?? '';
  let protectedSet;
  try {
    protectedSet = await protectedDigests(api, repository);
  } catch (error) {
    log(`retencja przerwana (fail-closed, nic nie usunięto): ${error instanceof Error ? error.message : 'error'}`);
    return { deleted: 0, candidates: 0, protected: 0, aborted: true };
  }
  let deleted = 0;
  let candidates = 0;
  for (const name of PACKAGES) {
    /** @type {Array<{ id: number, name: string, created_at: string }>} */
    let versions;
    try {
      versions = /** @type {Array<{ id: number, name: string, created_at: string }>} */ (
        await api.get(`/users/${owner}/packages/container/${name}/versions?per_page=100`)
      );
      if (!Array.isArray(versions)) throw new RetentionError('versions: unexpected answer');
    } catch (error) {
      log(`retencja przerwana dla ${name} (nic nie usunięto): ${error instanceof Error ? error.message : 'error'}`);
      return { deleted, candidates, protected: protectedSet.size, aborted: true };
    }
    const selected = versionsToDelete(versions, protectedSet);
    candidates += selected.length;
    log(
      `${name}: wersji ${String(versions.length)}, chronionych digestów ${String(protectedSet.size)}, do usunięcia ${String(selected.length)}`,
    );
    if (mode !== 'delete') continue;
    for (const version of selected) {
      await api.remove(`/users/${owner}/packages/container/${name}/versions/${String(version.id)}`);
      deleted += 1;
    }
  }
  log(
    mode === 'delete' ? `usunięto ${String(deleted)} wersji` : `tryb próbny (dry-run): nic nie usunięto, kandydatów ${String(candidates)}`,
  );
  return { deleted, candidates, protected: protectedSet.size, aborted: false };
}

/**
 * The GitHub API through fetch with the job token; artifact downloads follow the redirect without the token.
 * @param {string} token @param {typeof fetch} fetchImpl @param {string} base @returns {Api}
 */
export function githubApi(token, fetchImpl = fetch, base = 'https://api.github.com') {
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' };
  const request = async (/** @type {string} */ path, /** @type {string} */ method) => {
    const response = await fetchImpl(new URL(path, base), { method, headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300) throw new RetentionError(`${method} ${path}: ${String(response.status)}`);
    return response;
  };
  return {
    get: async (path) => (await request(path, 'GET')).json(),
    remove: async (path) => {
      await request(path, 'DELETE');
    },
    artifact: async (url) => {
      const first = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      const location = first.headers.get('location');
      if (first.status !== 302 || location === null || !location.startsWith('https://')) throw new RetentionError('artifact: no redirect');
      const second = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      if (second.status !== 200) throw new RetentionError('artifact: download');
      const bytes = new Uint8Array(await second.arrayBuffer());
      if (bytes.byteLength > LIMIT) throw new RetentionError('artifact: too large');
      return bytes;
    },
  };
}

/**
 * The step of the publish job: the repository and the mode from the environment (anything but `delete` is a dry run);
 * without a valid repository nothing is requested.
 * @param {Record<string, string | undefined>} env @param {(token: string) => Api} apiFactory @param {(line: string) => void} log
 */
export async function runFromEnv(env, apiFactory, log) {
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    log('retencja pominięta: brak GITHUB_REPOSITORY (owner/name) — nic nie usunięto');
    return null;
  }
  const mode = env['GHCR_RETENTION_MODE'] === 'delete' ? 'delete' : 'dry-run';
  return retention({ api: apiFactory(env['GITHUB_TOKEN'] ?? ''), repository, mode, log });
}
