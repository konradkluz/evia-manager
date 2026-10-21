/**
 * V1 — the history of `main` (EVM-007 AC3; ADR-0018 V1; architect 4, 5). HEAD is read from refs/heads/main (never an
 * ambiguous `main` that a tag could shadow). From the deployed commit (or the baseline) to HEAD the history must be a
 * fast-forward: the compare API says `ahead`, nothing behind, every page read (a partial list is a rejection), each
 * commit the child of the previous one, the last one HEAD.
 */
import { ensure, integer, isRecord, record, sha } from './errors.ts';
import type { GitHub } from './github.ts';

export interface RangeCommit {
  readonly sha: string;
  readonly parents: readonly string[];
}

/** The commit of refs/heads/main. */
export async function readHead(github: GitHub): Promise<string> {
  const { body } = await github.json(`${github.repoPath}/git/ref/heads/main`);
  const ref = record(body, 'v1-parse');
  ensure(ref['ref'] === 'refs/heads/main', 'v1-ref', 'not refs/heads/main');
  const object = record(ref['object'], 'v1-parse');
  ensure(object['type'] === 'commit', 'v1-ref', 'main does not point to a commit');
  return sha(object['sha'], 'v1-parse');
}

/** Commits after `base` up to `head`, oldest first; [] when they are equal. */
export async function readRange(github: GitHub, base: string, head: string, maxCommits: number): Promise<RangeCommit[]> {
  if (base === head) return [];
  const commits: RangeCommit[] = [];
  let next: string | null = `${github.repoPath}/compare/${base}...${head}?per_page=100`;
  let total = -1;
  for (let page = 0; next !== null; page += 1) {
    ensure(page < 10, 'v1-pages', 'too many compare pages');
    const result: { body: unknown; next: string | null } = await github.json(next);
    const body = record(result.body, 'v1-parse');
    ensure(body['status'] === 'ahead', 'v1-not-fast-forward', `status ${String(body['status'])}`);
    ensure(body['behind_by'] === 0, 'v1-not-fast-forward', 'behind');
    total = integer(body['total_commits'], 'v1-parse');
    ensure(total === integer(body['ahead_by'], 'v1-parse'), 'v1-parse', 'ahead_by differs from total_commits');
    ensure(total <= maxCommits, 'v1-range', `${String(total)} commits over the limit ${String(maxCommits)}`);
    ensure(Array.isArray(body['commits']), 'v1-parse', 'commits');
    for (const value of body['commits'] as unknown[]) {
      const commit = record(value, 'v1-parse');
      const parents = commit['parents'];
      ensure(Array.isArray(parents), 'v1-parse', 'parents');
      commits.push({
        sha: sha(commit['sha'], 'v1-parse'),
        parents: parents.map((parent) => sha(isRecord(parent) ? parent['sha'] : parent, 'v1-parse')),
      });
    }
    next = result.next;
  }
  ensure(commits.length === total, 'v1-incomplete', `${String(commits.length)} of ${String(total)} commits`);
  let previous = base;
  for (const commit of commits) {
    ensure(commit.parents[0] === previous, 'v1-chain', `${commit.sha} is not a child of ${previous}`);
    previous = commit.sha;
  }
  ensure(previous === head, 'v1-chain', 'the range does not end at HEAD');
  return commits;
}
