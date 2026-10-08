/**
 * The port through which other modules take part in a status change of a work order (EVM-030 AC5, SR-API-06, SR-API-07; domain-model.md →
 * "Zlecenie"). `work-orders` does not depend on `payments`: `payments` registers an implementation here (EVM-053: the condition of the
 * settlement and the effect `planned → cancelled` of the milestones; EVM-054: the condition of the cancellation) — the dependency is
 * inverted, there is no cycle. None is registered yet, so every condition is met until EVM-053.
 *
 * Rules of an implementation (the service relies on them):
 * - `check` runs UNDER THE LOCK of the order, in the transaction of the command, BEFORE anything is written. It answers `undefined`
 *   (the condition is met) or a stable machine code of the reason (`^[a-z][a-z0-9_]{0,63}$`, e.g. `unpaid_milestones`) — the answer
 *   is `422 transition_condition_not_met` with `/to` and the code, NEVER a value or a name;
 * - `apply` runs after the order was updated, in the SAME transaction: an error it throws rolls the whole command back — the status,
 *   the effects of the other participants, the audit record and the idempotency record;
 * - both read and write the database only: NO external I/O inside the transaction (a slow or hostile endpoint would hold the lock of
 *   the order and a connection; a call to a URL taken from data is an SSRF). Anything else is done after the commit by a job;
 * - the order of the calls is fixed: ascending `order`, then `name`; two implementations cannot share a name;
 * - it gets identifiers, the two statuses and the principal — never the reason of the command (free text, may name a person).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { WorkOrderStatus } from './domain/work-order-list-query.ts';

export interface TransitionContext {
  readonly workOrderId: string;
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;
  readonly principal: Principal;
  readonly now: Date;
}

export interface WorkOrderTransitionParticipant {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first. */
  readonly order: number;
  /** @returns `undefined` when the condition is met, otherwise the stable code of the reason it is not */
  check(tx: Kysely<Database>, context: TransitionContext): Promise<string | undefined>;
  apply(tx: Kysely<Database>, context: TransitionContext): Promise<void>;
}

const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The registry the participants announce themselves to; the service takes them in the fixed order. */
export class WorkOrderTransitionRegistry {
  readonly #participants = new Map<string, WorkOrderTransitionParticipant>();

  register(participant: WorkOrderTransitionParticipant): void {
    if (this.#participants.has(participant.name)) throw new Error(`transition participant ${participant.name} is already registered`);
    this.#participants.set(participant.name, participant);
  }

  ordered(): WorkOrderTransitionParticipant[] {
    return [...this.#participants.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  }

  /** The codes of the conditions that are not met, in the order of the participants, each once. Empty — the transition may go on. */
  async unmetConditions(tx: Kysely<Database>, context: TransitionContext): Promise<string[]> {
    const codes = new Set<string>();
    for (const participant of this.ordered()) {
      const code = await participant.check(tx, context);
      if (code === undefined) continue;
      if (!REASON_CODE.test(code)) throw new Error(`transition participant ${participant.name} returned an invalid reason code`);
      codes.add(code);
    }
    return [...codes];
  }

  async applyAll(tx: Kysely<Database>, context: TransitionContext): Promise<void> {
    for (const participant of this.ordered()) await participant.apply(tx, context);
  }
}
