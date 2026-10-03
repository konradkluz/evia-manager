// @ts-check
/**
 * K6 — integrity of `main` on GitHub Free (EVM-006 AC4, ADR-0016; security-engineer A1, W5, W6). Runs in the
 * `main-integrity` job after every push to main, with a read-only GITHUB_TOKEN (contents, actions, pull-requests: read).
 * Every commit of the push (before..after) must:
 *   1. be a fast-forward of the previous main (no force push, no rewritten history) and have exactly one parent;
 *   2. be the merge commit of a merged PR into main (merged_at set, merge_commit_sha equal to the commit);
 *   3. be merged by the configured owner (MAIN_MERGER) — not a bot and not GITHUB_TOKEN;
 *   4. have a green `ci-gate` job in the latest run of .github/workflows/ci.yml (push) for the PR head commit —
 *      read from the Actions API, never from commit statuses or check runs (tokens with statuses/checks write could forge them);
 *   5. have a first line in the Conventional Commits format with [EVM-###], [renovate] or [M#] and an optional " (#N)".
 * Fail closed: an API error, an unexpected answer or a missing value is red. Only node:* and the built-in fetch.
 */

/** First line of a commit on main (conventions.md → Git; W5). */
export const COMMIT_TITLE =
  /^(feat|fix|test|refactor|docs|chore|ci|build|perf|security|style|revert)(\([a-z0-9-]+\))?!?: \S.* \[(EVM-\d{3,}|renovate|M\d+)\]( \(#\d+\))?$/;
const SHA = /^[0-9a-f]{40}$/;
const ZERO = /^0{40}$/;
const API = 'https://api.github.com';
const CI_WORKFLOW = '.github/workflows/ci.yml';
const GATE_JOB = 'ci-gate';

/** @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} Fetch */

/**
 * @typedef {object} Io
 * @property {Record<string, string | undefined>} env
 * @property {Fetch} fetch
 * @property {(line: string) => void} log
 */

/** Untrusted text on one line without control characters (no injected `::` workflow commands). */
const oneLine = (/** @type {string} */ text) => text.replace(/\p{Cc}/gu, '?');
/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {});
/** @param {unknown} value @returns {unknown[]} */
const list = (value) => (Array.isArray(value) ? value : []);
/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * @param {Io} io
 * @returns {Promise<number>} 0 — main is consistent, 1 — red (incident: docs/ops/github-i-ci.md → revert), 2 — configuration
 */
export async function main({ env, fetch, log }) {
  const token = env['GITHUB_TOKEN'] ?? '';
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const merger = env['MAIN_MERGER'] ?? '';
  const before = env['BEFORE'] ?? '';
  const after = env['AFTER'] ?? '';
  if (token === '' || !/^[\w.-]+\/[\w.-]+$/.test(repository) || merger === '' || !SHA.test(before) || !SHA.test(after)) {
    log('main-integrity: wymagane zmienne GITHUB_TOKEN, GITHUB_REPOSITORY, MAIN_MERGER, BEFORE i AFTER (pełne SHA)');
    return 2;
  }
  /** @param {string} path */
  const get = async (path) => {
    // Error messages name the endpoint only — never the request headers (token).
    const where = path.replace(/\?.*$/, '');
    const response = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'evia-main-integrity',
      },
    }).catch(() => {
      throw new Error(`GitHub API niedostępne dla ${where}`);
    });
    if (!response.ok) throw new Error(`GitHub API ${String(response.status)} dla ${where}`);
    return response.json();
  };
  try {
    if (env['FORCED'] === 'true') throw new Error('force push na main — historia została nadpisana');
    if (ZERO.test(before)) throw new Error('brak poprzedniego stanu main (nowa lub odtworzona gałąź) — sprawdź ręcznie');
    const comparison = record(await get(`/repos/${repository}/compare/${before}...${after}`));
    const commits = list(comparison['commits']).map(record);
    if (text(comparison['status']) !== 'ahead')
      throw new Error(`main nie jest przewinięciem poprzedniego stanu (${text(comparison['status'])})`);
    if (Number(comparison['total_commits']) !== commits.length) throw new Error('zbyt wiele commitów w jednym pushu do weryfikacji');
    const problems = [];
    for (const commit of commits) {
      const sha = text(commit['sha']);
      const title = text(record(commit['commit'])['message']).replace(/\n[\s\S]*$/, '');
      const reasons = await verifyCommit({ sha, title, parents: list(commit['parents']).length }, { repository, merger, get });
      log(`- ${sha.slice(0, 12)} ${oneLine(title)} — ${reasons.length === 0 ? 'OK' : oneLine(reasons.join('; '))}`);
      if (reasons.length > 0) problems.push(sha);
    }
    if (problems.length > 0) {
      log(
        `main-integrity: CZERWONY — ${problems.length} commit(ów) na main bez ścieżki PR + zielony ci-gate; procedura: docs/ops/github-i-ci.md → „Czerwony main”`,
      );
      return 1;
    }
    log(`main-integrity: OK — ${commits.length} commit(ów) z PR scalonych przez ${oneLine(merger)} przy zielonym ci-gate`);
    return 0;
  } catch (error) {
    // Fail closed: every error (API, network, malformed answer) makes main red.
    log(`main-integrity: CZERWONY — ${oneLine(error instanceof Error ? error.message : String(error))}`);
    return 1;
  }
}

/**
 * @param {{ sha: string, title: string, parents: number }} commit
 * @param {{ repository: string, merger: string, get: (path: string) => Promise<unknown> }} context
 * @returns {Promise<string[]>} reasons why the commit is not acceptable (empty = OK)
 */
async function verifyCommit({ sha, title, parents }, { repository, merger, get }) {
  const reasons = [];
  if (parents !== 1) reasons.push(`commit ma ${String(parents)} rodziców (dozwolony wyłącznie squash merge)`);
  if (!COMMIT_TITLE.test(title)) reasons.push('pierwsza linia nie jest Conventional Commit z [EVM-###], [renovate] albo [M#]');
  const pulls = list(await get(`/repos/${repository}/commits/${sha}/pulls`)).map(record);
  const merged = pulls.find(
    (pull) => text(pull['merged_at']) !== '' && text(pull['merge_commit_sha']) === sha && text(record(pull['base'])['ref']) === 'main',
  );
  if (merged === undefined) return [...reasons, 'commit nie pochodzi ze scalonego PR do main (bezpośredni push?)'];
  const pull = record(await get(`/repos/${repository}/pulls/${String(merged['number'])}`));
  const login = text(record(pull['merged_by'])['login']);
  if (login !== merger) reasons.push(`PR #${String(merged['number'])} scalił ${login || 'nieznany'}, a nie ${merger}`);
  const head = text(record(pull['head'])['sha']);
  if (!(await gateGreen({ repository, head, get }))) reasons.push(`brak zielonego ${GATE_JOB} dla HEAD PR ${head.slice(0, 12)}`);
  return reasons;
}

/**
 * @param {{ repository: string, head: string, get: (path: string) => Promise<unknown> }} context
 */
async function gateGreen({ repository, head, get }) {
  if (!SHA.test(head)) return false;
  const runs = list(
    record(await get(`/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${head}&event=push&per_page=100`))['workflow_runs'],
  )
    .map(record)
    .filter((run) => text(run['path']) === CI_WORKFLOW && text(run['head_sha']) === head && text(run['event']) === 'push')
    .sort((a, b) => text(b['created_at']).localeCompare(text(a['created_at'])));
  const latest = runs[0];
  if (latest === undefined) return false;
  const jobs = list(
    record(await get(`/repos/${repository}/actions/runs/${String(latest['id'])}/jobs?filter=latest&per_page=100`))['jobs'],
  ).map(record);
  return jobs.some((job) => text(job['name']) === GATE_JOB && text(job['status']) === 'completed' && text(job['conclusion']) === 'success');
}
