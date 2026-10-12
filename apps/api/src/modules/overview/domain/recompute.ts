/**
 * The recomputation of the projection of ONE work order (ADR-0017 → "Funkcja przeliczenia"; D-rules of "Definicje wyliczeń"): a PURE
 * function of the data the system ports of the source modules return — no database, no clock, no role of the caller (W5, T8: the
 * result is the same for the Administrator, the Editor and `rebuild`). Nothing that depends on the day is computed here: "after
 * the deadline" and "days waited" are worked out when the list is read, from the injected clock (W3).
 *
 * - `waits`: the stages in the state `waiting` (the stages and processes that are deleted are never passed in);
 * - `waitingCount`: their number; the longest wait is the one with the smallest `waitingSince` (a tie: the position of the process,
 *   then the position of the stage, then the identifier of the stage — a total order, so the result is deterministic);
 * - `nextDueDate`: the smallest due date among the stages that are not finished (`todo`, `in_progress`, `waiting`, `blocked`).
 */

/** What `work-orders` tells about an order (the keys; never a title or a name). */
export interface OrderKeys {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly coordinatorUserId: string | null;
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly sourceTemplateId: string | null;
}

/** What `procedures` tells about an unfinished stage of a live process of the order. */
export interface UnfinishedStage {
  readonly stageId: string;
  readonly workOrderId: string;
  readonly procedurePosition: number;
  readonly stagePosition: number;
  readonly status: 'todo' | 'in_progress' | 'waiting' | 'blocked';
  readonly waitingOn: 'customer' | 'party' | null;
  readonly waitingOnPartyId: string | null;
  /** `YYYY-MM-DD` */
  readonly waitingSince: string | null;
  /** `YYYY-MM-DD` */
  readonly dueDate: string | null;
}

export interface SummaryColumns {
  readonly workOrderId: string;
  readonly number: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly coordinatorUserId: string | null;
  readonly customerId: string | null;
  readonly siteId: string | null;
  readonly siteType: string | null;
  readonly sourceTemplateId: string | null;
  readonly waitingCount: number;
  readonly longestWaitingSince: string | null;
  readonly longestWaitingOn: 'customer' | 'party' | null;
  readonly longestWaitingPartyId: string | null;
  readonly nextDueDate: string | null;
}

export interface WaitColumns {
  readonly stageId: string;
  readonly workOrderId: string;
  readonly waitingOn: 'customer' | 'party';
  readonly partyId: string | null;
  readonly partyKind: string | null;
  /** `YYYY-MM-DD` */
  readonly waitingSince: string;
}

export interface Projection {
  readonly summary: SummaryColumns;
  readonly waits: readonly WaitColumns[];
}

/** The groups of columns `verify` reports separately (W11); `authorization` is a security alert. */
export const COLUMN_GROUPS = ['authorization', 'keys', 'waiting', 'deadline'] as const;
export type ColumnGroup = (typeof COLUMN_GROUPS)[number];

/** `YYYY-MM-DD` strings compare as dates. */
function byWaiting(a: UnfinishedStage, b: UnfinishedStage): number {
  const since = (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '');
  if (since !== 0) return since;
  if (a.procedurePosition !== b.procedurePosition) return a.procedurePosition - b.procedurePosition;
  if (a.stagePosition !== b.stagePosition) return a.stagePosition - b.stagePosition;
  return a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0;
}

function toWait(stage: UnfinishedStage, workOrderId: string, partyKinds: ReadonlyMap<string, string>): WaitColumns {
  if (stage.waitingOn === null || stage.waitingSince === null) throw new Error('A waiting stage without "waiting for" or "since"');
  if (stage.waitingOn === 'customer') {
    return { stageId: stage.stageId, workOrderId, waitingOn: 'customer', partyId: null, partyKind: null, waitingSince: stage.waitingSince };
  }
  const kind = stage.waitingOnPartyId === null ? undefined : partyKinds.get(stage.waitingOnPartyId);
  if (stage.waitingOnPartyId === null || kind === undefined) throw new Error('A stage waits for a party of an unknown kind');
  return {
    stageId: stage.stageId,
    workOrderId,
    waitingOn: 'party',
    partyId: stage.waitingOnPartyId,
    partyKind: kind,
    waitingSince: stage.waitingSince,
  };
}

/**
 * @param stages the unfinished stages of the order (the caller passes only this order's)
 * @param partyKinds the kind of every party a stage waits for (a party that is waited for always exists: the key is RESTRICT)
 * @throws Error when a stage waits for a party whose kind is unknown (the transaction is rolled back — fail closed)
 */
export function computeProjection(
  keys: OrderKeys,
  siteType: string | null,
  stages: readonly UnfinishedStage[],
  partyKinds: ReadonlyMap<string, string>,
): Projection {
  // a stage in `waiting` always has its day through the API (EVM-032); the column is nullable, and a stage without it cannot be
  // dated, so it is not listed as a wait (the recomputation of the whole order must not fail on one row the API cannot write)
  const waits = stages
    .filter((stage) => stage.status === 'waiting' && stage.waitingSince !== null)
    .sort(byWaiting)
    .map((stage) => toWait(stage, keys.id, partyKinds));
  const first = waits[0];
  const dueDates = stages.flatMap((stage) => (stage.dueDate === null ? [] : [stage.dueDate]));
  const nextDueDate = dueDates.length === 0 ? null : dueDates.reduce((least, date) => (date < least ? date : least));
  return {
    summary: {
      workOrderId: keys.id,
      number: keys.number,
      status: keys.status,
      createdAt: keys.createdAt,
      deletedAt: keys.deletedAt,
      coordinatorUserId: keys.coordinatorUserId,
      customerId: keys.customerId,
      siteId: keys.siteId,
      siteType,
      sourceTemplateId: keys.sourceTemplateId,
      waitingCount: waits.length,
      longestWaitingSince: first?.waitingSince ?? null,
      longestWaitingOn: first?.waitingOn ?? null,
      longestWaitingPartyId: first?.partyId ?? null,
      nextDueDate,
    },
    waits,
  };
}

const waitKey = (wait: WaitColumns): string =>
  [wait.stageId, wait.waitingOn, wait.partyId ?? '', wait.partyKind ?? '', wait.waitingSince].join('|');

/** The groups of columns in which a stored row differs from the recomputed one (empty: the same). */
export function differingGroups(stored: Projection, computed: Projection): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  const a = stored.summary;
  const b = computed.summary;
  if ((a.deletedAt?.getTime() ?? null) !== (b.deletedAt?.getTime() ?? null)) groups.push('authorization');
  if (
    a.number !== b.number ||
    a.status !== b.status ||
    a.createdAt.getTime() !== b.createdAt.getTime() ||
    a.coordinatorUserId !== b.coordinatorUserId ||
    a.customerId !== b.customerId ||
    a.siteId !== b.siteId ||
    a.siteType !== b.siteType ||
    a.sourceTemplateId !== b.sourceTemplateId
  ) {
    groups.push('keys');
  }
  const storedWaits = stored.waits.map(waitKey).sort().join(';');
  const computedWaits = computed.waits.map(waitKey).sort().join(';');
  if (
    a.waitingCount !== b.waitingCount ||
    a.longestWaitingSince !== b.longestWaitingSince ||
    a.longestWaitingOn !== b.longestWaitingOn ||
    a.longestWaitingPartyId !== b.longestWaitingPartyId ||
    storedWaits !== computedWaits
  ) {
    groups.push('waiting');
  }
  if (a.nextDueDate !== b.nextDueDate) groups.push('deadline');
  return groups;
}
