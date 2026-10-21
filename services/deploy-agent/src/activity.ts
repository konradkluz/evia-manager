/**
 * V0 — the Activity of `main` (EVM-007 AC3; ADR-0018 V0, n5; architect 5; security-engineer B "V0").
 * Anchored by ID, never by time: the walk (newest first, every page) stops at the Activity event of the anchor (the
 * previous deployment, or the baseline). Every event after it must be `pr_merge` by Konrad's numeric account ID on
 * refs/heads/main — any other or unknown type (push, force_push, branch_deletion, branch_creation, merge_queue_merge …)
 * is a violation — and the events must form one unbroken chain (before = after of the previous event) from the anchor
 * commit to HEAD. An anchor not found before the pages end (retention, window of the API) rejects the cycle.
 */
import { Rejection, ensure, integer, isRecord, record, sha, string } from './errors.ts';
import type { GitHub } from './github.ts';

export interface ActivityEvent {
  readonly id: number;
  readonly type: string;
  readonly before: string;
  readonly after: string;
  readonly ref: string;
  readonly actorId: number | null;
}

export interface Anchor {
  readonly commit: string;
  readonly activityEventId: number;
}

export interface ActivityChain {
  /** Events after the anchor, oldest first. */
  readonly events: readonly ActivityEvent[];
  /** Index of the first event that breaks the rules (type, actor, ref or chain), or -1. */
  readonly violation: number;
  readonly reason: string | null;
}

function parseEvent(value: unknown): ActivityEvent {
  const event = record(value, 'v0-parse');
  const actor = event['actor'];
  return {
    id: integer(event['id'], 'v0-parse'),
    type: string(event['activity_type'], 'v0-parse'),
    before: sha(event['before'], 'v0-parse'),
    after: sha(event['after'], 'v0-parse'),
    ref: string(event['ref'], 'v0-parse'),
    actorId: isRecord(actor) && typeof actor['id'] === 'number' ? actor['id'] : null,
  };
}

/** Reads the Activity of main back to the anchor event (newest first, every page). */
export async function readActivity(github: GitHub, anchor: Anchor): Promise<ActivityEvent[]> {
  const newer: ActivityEvent[] = [];
  let next: string | null = `${github.repoPath}/activity?ref=${encodeURIComponent('refs/heads/main')}&direction=desc&per_page=100`;
  for (let page = 0; next !== null; page += 1) {
    ensure(page < 30, 'v0-pages', 'too many Activity pages');
    const result: { body: unknown; next: string | null } = await github.json(next);
    ensure(Array.isArray(result.body), 'v0-parse', 'list expected');
    for (const value of result.body as unknown[]) {
      const event = parseEvent(value);
      if (event.id === anchor.activityEventId) {
        ensure(event.after === anchor.commit, 'v0-anchor', 'the anchor event does not lead to the anchor commit');
        return newer.reverse();
      }
      newer.push(event);
    }
    next = result.next;
  }
  throw new Rejection('v0-anchor-not-found', 'Activity ends before the anchor (retention or window of the API)');
}

/** Validates the chain: allowed type, actor and ref of every event, continuity from the anchor commit. */
export function checkChain(events: readonly ActivityEvent[], anchor: Anchor, ownerAccountId: number): ActivityChain {
  let previous = anchor.commit;
  for (const [index, event] of events.entries()) {
    if (event.ref !== 'refs/heads/main') return { events, violation: index, reason: `v0-ref: event ${String(event.id)}` };
    if (event.type !== 'pr_merge') return { events, violation: index, reason: `v0-event-type: ${event.type} (event ${String(event.id)})` };
    if (event.actorId !== ownerAccountId) return { events, violation: index, reason: `v0-actor: event ${String(event.id)}` };
    if (event.before !== previous) return { events, violation: index, reason: `v0-chain: event ${String(event.id)}` };
    previous = event.after;
  }
  return { events, violation: -1, reason: null };
}
