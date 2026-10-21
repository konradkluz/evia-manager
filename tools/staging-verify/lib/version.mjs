// @ts-check
/**
 * Waiting for the deployment (EVM-007 AC6; ADR-0018 "Staging"): GET /version of staging must report the commit of this
 * run and the manifestSha256 output of `publish` (services/deploy-agent/README.md) before the checks start. A mismatch
 * after the waiting time is red; a 5xx, a timeout or a body that is not the expected JSON only means "keep waiting".
 */

const SHA = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @param {{ url: string, commit: string, manifestSha256: string, timeoutMs: number, intervalMs: number,
 *   fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, now?: () => number }} options
 * @returns {Promise<import('./checks.mjs').Check>}
 */
export async function waitForVersion({ url, commit, manifestSha256, timeoutMs, intervalMs, fetchImpl = fetch, sleep, now = Date.now }) {
  if (!SHA.test(commit) || !HEX64.test(manifestSha256))
    return { id: 'version', passed: false, details: ['brak poprawnego commitu albo manifestSha256 z joba publish'] };
  const wait = sleep ?? ((/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  /** @type {string} */
  let last;
  for (;;) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: { 'cache-control': 'no-cache' },
      });
      if (response.status === 200) {
        const body = /** @type {Record<string, unknown>} */ (await response.json());
        if (body['commit'] === commit && body['manifestSha256'] === manifestSha256)
          return { id: 'version', passed: true, details: [`/version = ${commit}, manifest ${manifestSha256}`] };
        last = `/version = ${String(body['commit'])}, manifest ${String(body['manifestSha256'])}`;
      } else {
        last = `status ${String(response.status)}`;
      }
    } catch {
      last = 'błąd połączenia albo odpowiedź spoza JSON';
    }
    if (now() + intervalMs > deadline) return { id: 'version', passed: false, details: [`po czasie oczekiwania: ${last}`] };
    await wait(intervalMs);
  }
}
