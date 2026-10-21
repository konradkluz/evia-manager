/**
 * V2 — every commit of the range is a squash merge by Konrad of a pull request to main whose final HEAD had a green
 * full run of ci.yml (EVM-007 AC3; ADR-0018 V2, m1; EVM-083 AC1; architect 6; security-engineer B "V2").
 * - The commit has exactly one parent (squash).
 * - Exactly one pull request has merge_commit_sha = the commit; it is merged, to main, merged by Konrad's numeric ID.
 * - A run of the workflow with the configured numeric ID, event `pull_request`, head_sha = the final HEAD of the pull
 *   request, completed with success, whose job `ci-gate` succeeded — read from the jobs API of that run attempt, never
 *   from a check run or a status (a workflow of a branch can create those). Fast branch-push runs are never accepted.
 * Residual risk (TM, RR-23): the pull_request run uses ci.yml of the pull request branch, so V2 is as strong as Konrad's
 * review of .github/** (K3).
 */
import { Rejection, ensure, integer, isRecord, record, sha, string } from './errors.ts';
import type { GitHub } from './github.ts';
import type { RangeCommit } from './history.ts';

export interface PullRequestEvidence {
  readonly commit: string;
  readonly pullRequest: number;
  readonly headSha: string;
  readonly runId: number;
}

export interface Owner {
  readonly accountId: number;
  readonly workflowId: number;
}

/** The jobs of a run attempt (jobs API of the attempt): name → the `status/conclusion` of every job of that name. */
export async function jobStates(github: GitHub, runId: number, attempt: number): Promise<Map<string, string[]>> {
  const jobs = await github.all(
    `${github.repoPath}/actions/runs/${String(runId)}/attempts/${String(attempt)}/jobs?per_page=100`,
    'jobs',
    5,
  );
  const states = new Map<string, string[]>();
  for (const value of jobs) {
    if (!isRecord(value) || typeof value['name'] !== 'string') continue;
    states.set(value['name'], [...(states.get(value['name']) ?? []), `${String(value['status'])}/${String(value['conclusion'])}`]);
  }
  return states;
}

/** A job of that name succeeded in the attempt. */
export const succeeded = (states: Map<string, string[]>, name: string): boolean => (states.get(name) ?? []).includes('completed/success');

/** A job of a run attempt succeeded (jobs API of the attempt). */
export async function jobSucceeded(github: GitHub, runId: number, attempt: number, name: string): Promise<boolean> {
  return succeeded(await jobStates(github, runId, attempt), name);
}

export async function checkPullRequest(github: GitHub, commit: RangeCommit, owner: Owner): Promise<PullRequestEvidence> {
  ensure(commit.parents.length === 1, 'v2-not-squash', `${commit.sha} has ${String(commit.parents.length)} parents`);
  const pulls = await github.all(`${github.repoPath}/commits/${commit.sha}/pulls?per_page=100`, undefined, 3);
  const matching = pulls.filter((value) => isRecord(value) && value['merge_commit_sha'] === commit.sha);
  ensure(matching.length === 1, 'v2-no-pull-request', `${commit.sha}: ${String(matching.length)} pull requests`);
  const number = integer(record(matching[0], 'v2-parse')['number'], 'v2-parse');
  const { body } = await github.json(`${github.repoPath}/pulls/${String(number)}`);
  const pull = record(body, 'v2-parse');
  ensure(pull['merged'] === true, 'v2-not-merged', `#${String(number)}`);
  ensure(pull['merge_commit_sha'] === commit.sha, 'v2-merge-commit', `#${String(number)}`);
  ensure(string(record(pull['base'], 'v2-parse')['ref'], 'v2-parse') === 'main', 'v2-base', `#${String(number)} not to main`);
  const mergedBy = pull['merged_by'];
  ensure(isRecord(mergedBy) && mergedBy['id'] === owner.accountId, 'v2-merged-by', `#${String(number)} merged by another account`);
  const headSha = sha(record(pull['head'], 'v2-parse')['sha'], 'v2-parse');
  const runs = await github.all(
    `${github.repoPath}/actions/workflows/${String(owner.workflowId)}/runs?head_sha=${headSha}&event=pull_request&status=completed&per_page=100`,
    'workflow_runs',
    3,
  );
  const candidates = runs
    .filter(isRecord)
    .filter(
      (run) =>
        run['workflow_id'] === owner.workflowId &&
        run['head_sha'] === headSha &&
        run['event'] === 'pull_request' &&
        run['status'] === 'completed' &&
        run['conclusion'] === 'success',
    )
    .sort((a, b) => Number(b['id']) - Number(a['id']));
  for (const run of candidates) {
    const runId = integer(run['id'], 'v2-parse');
    if (await jobSucceeded(github, runId, integer(run['run_attempt'], 'v2-parse'), 'ci-gate'))
      return { commit: commit.sha, pullRequest: number, headSha, runId };
  }
  throw new Rejection('v2-ci-gate', `#${String(number)}: no successful pull_request run of the workflow with a green ci-gate`);
}
