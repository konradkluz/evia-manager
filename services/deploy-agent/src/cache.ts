/**
 * The verifier's memory of results that can no longer change (EVM-007 AC3; ADR-0018 n3; architect, review round 1):
 * commits after the deployed one that never get a release (documentation only — `publish` skipped, EVM-083) stay in the
 * range until the next release, and checking them again every 90 s would exhaust the hourly limit of the API.
 * Remembered: V2 passed for a commit (a merged pull request, its merged_by, a completed green pull_request run — facts
 * of the past) and V3 `skipped` (an attempt of the push run with a green ci-gate skipped publish, which a re-run repeats). Never
 * remembered: a rejection, `unusable` (a job still running, failed — may change), V0 and V1 (both run every cycle), V3 of the
 * commit to deploy and V4. Kept in the verifier's own state directory (writable by the verifier only), keyed by the
 * baseline; a missing, unreadable, oversized or foreign file is an empty cache — the price is requests, never a
 * weaker check. Pruned to the commits of the current range.
 */
import { SHA, isRecord } from './errors.ts';
import type { PullRequestEvidence } from './pulls.ts';

const MAX_ENTRIES = 1000;

export class VerificationCache {
  readonly baseline: string;
  readonly #pulls: Map<string, PullRequestEvidence>;
  readonly #skipped: Set<string>;

  constructor(baseline: string, pulls: Iterable<PullRequestEvidence> = [], skipped: Iterable<string> = []) {
    this.baseline = baseline;
    this.#pulls = new Map([...pulls].map((evidence) => [evidence.commit, evidence]));
    this.#skipped = new Set(skipped);
  }

  /** The cache file of the state directory; anything unexpected is an empty cache of this baseline. */
  static parse(text: string | null, baseline: string): VerificationCache {
    const empty = new VerificationCache(baseline);
    if (text === null) return empty;
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return empty;
    }
    if (!isRecord(document) || document['schemaVersion'] !== 1 || document['baseline'] !== baseline) return empty;
    const pulls = document['pulls'];
    const skipped = document['skipped'];
    if (!Array.isArray(pulls) || !Array.isArray(skipped) || pulls.length + skipped.length > MAX_ENTRIES) return empty;
    if (!pulls.every(isEvidence) || !skipped.every((commit) => typeof commit === 'string' && SHA.test(commit))) return empty;
    return new VerificationCache(baseline, pulls, skipped as string[]);
  }

  pull(commit: string): PullRequestEvidence | undefined {
    return this.#pulls.get(commit);
  }

  rememberPull(evidence: PullRequestEvidence): void {
    this.#pulls.set(evidence.commit, evidence);
  }

  isSkipped(commit: string): boolean {
    return this.#skipped.has(commit);
  }

  rememberSkipped(commit: string): void {
    this.#skipped.add(commit);
  }

  /** Keeps only the commits of the current range (older ones are deployed or behind the frontier). */
  prune(range: readonly string[]): void {
    const keep = new Set(range);
    for (const commit of this.#pulls.keys()) if (!keep.has(commit)) this.#pulls.delete(commit);
    for (const commit of this.#skipped) if (!keep.has(commit)) this.#skipped.delete(commit);
  }

  serialize(): string {
    return `${JSON.stringify({ schemaVersion: 1, baseline: this.baseline, pulls: [...this.#pulls.values()], skipped: [...this.#skipped] })}\n`;
  }
}

function isEvidence(value: unknown): value is PullRequestEvidence {
  if (!isRecord(value) || Object.keys(value).length !== 4) return false;
  const { commit, pullRequest, headSha, runId } = value;
  return (
    typeof commit === 'string' &&
    SHA.test(commit) &&
    typeof headSha === 'string' &&
    SHA.test(headSha) &&
    Number.isSafeInteger(pullRequest) &&
    Number(pullRequest) > 0 &&
    Number.isSafeInteger(runId) &&
    Number(runId) > 0
  );
}
