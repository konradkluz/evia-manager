// @ts-check
/**
 * Alarm of a red publication on main (EVM-153 AC4b; security-engineer: V16.3.3, CWE-636, SR-LOG-02).
 * The latest completed `push` run of ci.yml on main in which `publish` or `publish-infra` executed (conclusion other than
 * `skipped`) must have every executed one of them `success`; otherwise the result is red. Fail-closed: an API error (403, 429, 5xx),
 * an unreadable answer, a missing job (a renamed one), an unknown conclusion or no such run at all is red as well.
 * - The host comes from GITHUB_API_URL (the runner), the repository from GITHUB_REPOSITORY (format checked): no user input, no SSRF.
 * - Jobs are read with filter=latest (a re-run replaces the earlier attempt) and matched by the exact name; full pagination.
 * - The message holds only the job name, run id and URL, the commit SHA and the age in days — never the author, the e-mail or the commit message.
 */

export const WATCHED_JOBS = Object.freeze(['publish', 'publish-infra']);
export const WORKFLOW_FILE = 'ci.yml';
/** How many completed runs are looked at (newest first) when looking for the latest one in which a watched job executed. */
export const MAX_RUNS = 30;
const PER_PAGE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/;

export class WatchError extends Error {}

/** @typedef {{ id: number, head_sha: string, created_at: string }} Run */
/** @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} Fetch */

/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WatchError('unreadable API answer');
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * One GET of the API; anything but a readable 200 is an error (the body is never echoed).
 * @param {Fetch} fetchImpl @param {string} url @param {string} token
 */
async function get(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    });
  } catch {
    throw new WatchError('GitHub API unreachable');
  }
  if (!response.ok) throw new WatchError(`GitHub API answered ${String(response.status)}`);
  try {
    return record(await response.json());
  } catch {
    throw new WatchError('unreadable API answer');
  }
}

/**
 * The completed push runs of ci.yml on main, newest first, at most MAX_RUNS.
 * @param {{ fetch: Fetch, api: string, repository: string, token: string }} context @returns {Promise<Run[]>}
 */
export async function listRuns({ fetch, api, repository, token }) {
  /** @type {Run[]} */
  const runs = [];
  for (let page = 1; runs.length < MAX_RUNS; page += 1) {
    const query = `branch=main&event=push&status=completed&per_page=${String(PER_PAGE)}&page=${String(page)}`;
    const body = await get(fetch, `${api}/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?${query}`, token);
    const batch = body['workflow_runs'];
    if (!Array.isArray(batch)) throw new WatchError('unreadable API answer');
    for (const item of batch) {
      const run = record(item);
      const { id, head_sha: sha, created_at: created } = run;
      if (
        typeof id !== 'number' ||
        typeof sha !== 'string' ||
        !SHA.test(sha) ||
        typeof created !== 'string' ||
        Number.isNaN(Date.parse(created))
      )
        throw new WatchError('unreadable run');
      runs.push({ id, head_sha: sha, created_at: created });
    }
    if (batch.length < PER_PAGE) break;
  }
  return runs.slice(0, MAX_RUNS);
}

/**
 * Conclusion of each watched job of one run (latest attempt, exact name). A watched job missing from the list is an error:
 * a renamed or removed job must never silence the alarm; a job that did not run is listed with conclusion `skipped`.
 * @param {{ fetch: Fetch, api: string, repository: string, token: string }} context @param {number} runId
 * @returns {Promise<Record<string, string>>}
 */
export async function jobConclusions({ fetch, api, repository, token }, runId) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (let page = 1; ; page += 1) {
    const query = `filter=latest&per_page=${String(PER_PAGE)}&page=${String(page)}`;
    const body = await get(fetch, `${api}/repos/${repository}/actions/runs/${String(runId)}/jobs?${query}`, token);
    const jobs = body['jobs'];
    if (!Array.isArray(jobs)) throw new WatchError('unreadable API answer');
    for (const item of jobs) {
      const job = record(item);
      if (typeof job['name'] === 'string' && WATCHED_JOBS.includes(job['name'])) {
        const conclusion = job['conclusion'];
        if (typeof conclusion !== 'string') throw new WatchError(`job ${job['name']} of run ${String(runId)} has no conclusion`);
        found.set(job['name'], conclusion);
      }
    }
    if (jobs.length < PER_PAGE) break;
  }
  const missing = WATCHED_JOBS.filter((name) => !found.has(name));
  if (missing.length > 0) throw new WatchError(`run ${String(runId)} has no job ${missing.join(', ')} (renamed or removed?)`);
  return Object.fromEntries(found);
}

/** The ordered findings of the watch: red jobs of the latest executed run with the age of the streak. @typedef {{ job: string, runId: number, sha: string, conclusion: string, days: number }} Finding */

/**
 * @param {{ fetch: Fetch, api: string, repository: string, token: string, now: Date }} context
 * @returns {Promise<{ runId: number, findings: Finding[] }>}
 */
export async function evaluate(context) {
  const runs = await listRuns(context);
  /** @type {{ run: Run, conclusions: Record<string, string> }[]} */
  const executed = [];
  for (const run of runs) {
    const conclusions = await jobConclusions(context, run.id);
    if (Object.values(conclusions).some((conclusion) => conclusion !== 'skipped')) {
      executed.push({ run, conclusions });
      break;
    }
  }
  const latest = executed[0];
  if (latest === undefined)
    throw new WatchError(
      `no completed run of ${WORKFLOW_FILE} on main in which publish or publish-infra executed (last ${String(runs.length)} runs)`,
    );
  /** @type {Finding[]} */
  const findings = [];
  for (const job of WATCHED_JOBS) {
    const conclusion = latest.conclusions[job] ?? '';
    if (conclusion === 'success' || conclusion === 'skipped') continue;
    // Age of the failure: the oldest run of the unbroken streak in which this job executed and did not succeed.
    let since = latest.run;
    for (const older of runs.slice(runs.indexOf(latest.run) + 1)) {
      const result = (await jobConclusions(context, older.id))[job] ?? '';
      if (result === 'skipped') continue;
      if (result === 'success') break;
      since = older;
    }
    const days = Math.max(0, Math.floor((context.now.getTime() - Date.parse(since.created_at)) / DAY_MS));
    findings.push({ job, runId: latest.run.id, sha: latest.run.head_sha, conclusion, days });
  }
  return { runId: latest.run.id, findings };
}

/**
 * Entry of the nightly job: returns the exit code (0 green, 1 red or error). @param {{ env: Record<string, string | undefined>, fetch: Fetch, now: Date, log: (line: string) => void }} io
 */
export async function run({ env, fetch, now, log }) {
  try {
    const repository = env['GITHUB_REPOSITORY'] ?? '';
    if (!REPOSITORY.test(repository)) throw new WatchError('GITHUB_REPOSITORY is not owner/name');
    const api = (env['GITHUB_API_URL'] ?? '').replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._/-]*)?$/.test(api)) throw new WatchError('GITHUB_API_URL is not an https URL');
    const token = env['GITHUB_TOKEN'] ?? '';
    if (token === '') throw new WatchError('GITHUB_TOKEN is missing');
    const server = (env['GITHUB_SERVER_URL'] ?? 'https://github.com').replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(server)) throw new WatchError('GITHUB_SERVER_URL is not an https origin');
    const { runId, findings } = await evaluate({ fetch, api, repository, token, now });
    for (const finding of findings) {
      log(
        `::error title=publish-watch::${finding.job} ${finding.conclusion} in run ${String(finding.runId)} (${server}/${repository}/actions/runs/${String(finding.runId)}), commit ${finding.sha}, failing for ${String(finding.days)} day(s)`,
      );
    }
    if (findings.length > 0) return 1;
    log(`publish-watch: the latest run in which a publication executed (${String(runId)}) is green`);
    return 0;
  } catch (error) {
    const message = error instanceof WatchError ? error.message : 'unexpected error';
    log(`::error title=publish-watch::${message} (fail-closed)`);
    return 1;
  }
}
