// @ts-check
/**
 * K6 — integrity of `main` on GitHub Free (EVM-006 AC4, ADR-0016; security-engineer A1, W5, W6 and the review of the
 * first implementation). Runs in .github/workflows/main-integrity.yml after every push to main and nightly, with a
 * read-only GITHUB_TOKEN (contents, actions, pull-requests: read).
 * Every run re-checks a rolling window — the newest WINDOW commits of main down to (excluding) BASELINE, the last commit
 * of main before K6 — not only the commits of the push: a commit pushed with GITHUB_TOKEN starts no workflow, so the
 * next push or the nightly run must still see it. Every commit in the window must:
 *   1. have exactly one parent (squash merge); on a push, main must be a fast-forward of the previous main;
 *   2. be the merge commit of a merged PR into main (merged_at set, merge_commit_sha equal to the commit);
 *   3. be merged by the configured owner (MAIN_MERGER) — not a bot and not GITHUB_TOKEN;
 *   4. have a green `ci-gate` job in the latest run of .github/workflows/ci.yml (push) for the PR head commit —
 *      read from the Actions API, never from commit statuses or check runs (tokens with statuses/checks write could forge them);
 *   5. have a first line in the Conventional Commits format with [EVM-###], [renovate] or [M#] and an optional " (#N)".
 * Commits changing SENSITIVE_PATHS are listed separately: a push that changes K6 itself or the workflows can neutralise
 * later runs, which only the Activity view of the repository shows (docs/ops/github-i-ci.md).
 * Fail closed: an API error, an unexpected answer or a missing value is red. Only node:* and the built-in fetch.
 */

/** First line of a commit on main (conventions.md → Git; W5). */
export const COMMIT_TITLE =
  /^(feat|fix|test|refactor|docs|chore|ci|build|perf|security|style|revert)(\([a-z0-9-]+\))?!?: \S.* \[(EVM-\d{3,}|renovate|M\d+)\]( \(#\d+\))?$/;
/**
 * Newest commits of main re-checked by every run. Each commit costs 5 API requests, so a run stays at about 150 of the
 * 1000 requests per hour that GITHUB_TOKEN may use in a repository.
 */
export const WINDOW = 30;
/** Paths whose change can neutralise K6 or the scans — listed for the manual Activity check. */
export const SENSITIVE_PATHS = Object.freeze(['.github/', 'tools/main-integrity/', 'tools/scan/']);
/** GitHub lists at most 300 files of a commit in one answer. */
const FILES_LIMIT = 300;
const SHA = /^[0-9a-f]{40}$/;
const ZERO = /^0{40}$/;
const EVENTS = ['push', 'schedule', 'workflow_dispatch'];
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
/** @param {unknown} value @param {string} what @returns {unknown[]} */
const required = (value, what) => {
  if (!Array.isArray(value)) throw new Error(`nieoczekiwana odpowiedź GitHub API (${what})`);
  return value;
};

/**
 * @param {Io} io
 * @returns {Promise<number>} 0 — main is consistent, 1 — red (incident: docs/ops/github-i-ci.md → revert), 2 — configuration
 */
export async function main({ env, fetch, log }) {
  const token = env['GITHUB_TOKEN'] ?? '';
  const repository = env['GITHUB_REPOSITORY'] ?? '';
  const merger = env['MAIN_MERGER'] ?? '';
  const event = env['EVENT'] ?? '';
  const baseline = env['BASELINE'] ?? '';
  const before = env['BEFORE'] ?? '';
  const after = env['AFTER'] ?? '';
  const push = event === 'push';
  if (
    token === '' ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    merger === '' ||
    !EVENTS.includes(event) ||
    !SHA.test(baseline) ||
    !SHA.test(after) ||
    (push && !SHA.test(before))
  ) {
    log(
      'main-integrity: wymagane zmienne GITHUB_TOKEN, GITHUB_REPOSITORY, MAIN_MERGER, EVENT (push, schedule, workflow_dispatch), BASELINE i AFTER (pełne SHA), przy push także BEFORE',
    );
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
    if (push) await verifyPush({ env, repository, before, after, get });
    const commits = await windowOf({ repository, after, baseline, get });
    log(
      `main-integrity: ${commits.length} commit(ów) main od ${after.slice(0, 12)} do bazy ${baseline.slice(0, 12)} (zdarzenie: ${event})`,
    );
    const problems = [];
    /** @type {string[]} */
    const sensitive = [];
    for (const commit of commits) {
      const sha = text(commit['sha']);
      const title = text(record(commit['commit'])['message']).replace(/\n[\s\S]*$/, '');
      const touched = await sensitiveFiles({ repository, sha, get });
      if (touched !== null) sensitive.push(`- ${sha.slice(0, 12)}: ${oneLine(touched)}`);
      const reasons = await verifyCommit({ sha, title, parents: list(commit['parents']).length }, { repository, merger, get });
      log(`- ${sha.slice(0, 12)} ${oneLine(title)} — ${reasons.length === 0 ? 'OK' : oneLine(reasons.join('; '))}`);
      if (reasons.length > 0) problems.push(sha);
    }
    if (sensitive.length > 0) {
      log(
        `Commity zmieniające ${SENSITIVE_PATHS.join(', ')} — mogą wyłączyć K6 albo skany; potwierdź w widoku Activity, że weszły przez „Pull request merge” Konrada:`,
      );
      for (const line of sensitive) log(line);
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
 * A push to main: no force push, a fast-forward of the previous main, and every pushed commit inside the window.
 * @param {{ env: Record<string, string | undefined>, repository: string, before: string, after: string, get: (path: string) => Promise<unknown> }} context
 */
async function verifyPush({ env, repository, before, after, get }) {
  if (env['FORCED'] === 'true') throw new Error('force push na main — historia została nadpisana');
  if (ZERO.test(before)) throw new Error('brak poprzedniego stanu main (nowa lub odtworzona gałąź) — sprawdź ręcznie');
  const comparison = record(await get(`/repos/${repository}/compare/${before}...${after}`));
  if (text(comparison['status']) !== 'ahead')
    throw new Error(`main nie jest przewinięciem poprzedniego stanu (${text(comparison['status'])})`);
  const total = Number(comparison['total_commits']);
  if (total !== list(comparison['commits']).length || total > WINDOW)
    throw new Error(`zbyt wiele commitów w jednym pushu do weryfikacji (${String(total)}, okno ${String(WINDOW)})`);
}

/**
 * The newest WINDOW commits of main from AFTER, without BASELINE and the history below it.
 * @param {{ repository: string, after: string, baseline: string, get: (path: string) => Promise<unknown> }} context
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function windowOf({ repository, after, baseline, get }) {
  const history = required(await get(`/repos/${repository}/commits?sha=${after}&per_page=${String(WINDOW)}`), 'lista commitów main').map(
    record,
  );
  if (text(history[0]?.['sha']) !== after) throw new Error('lista commitów main nie zaczyna się od AFTER');
  const end = history.findIndex((commit) => text(commit['sha']) === baseline);
  if (end === -1 && history.length < WINDOW)
    throw new Error('BASELINE nie jest przodkiem main — historia przepisana albo błędna konfiguracja workflowu');
  return end === -1 ? history : history.slice(0, end);
}

/**
 * Sensitive files changed by the commit, or null when it changes none.
 * @param {{ repository: string, sha: string, get: (path: string) => Promise<unknown> }} context
 * @returns {Promise<string | null>}
 */
async function sensitiveFiles({ repository, sha, get }) {
  const files = required(record(await get(`/repos/${repository}/commits/${sha}`))['files'], `pliki commita ${sha.slice(0, 12)}`);
  if (files.length >= FILES_LIMIT) return `lista plików obcięta (≥ ${String(FILES_LIMIT)}) — sprawdź ręcznie`;
  const names = files
    .map((file) => text(record(file)['filename']))
    .filter((name) => SENSITIVE_PATHS.some((prefix) => name.startsWith(prefix)));
  return names.length === 0 ? null : names.join(', ');
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
