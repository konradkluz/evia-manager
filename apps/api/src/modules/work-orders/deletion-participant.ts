/**
 * The port through which other modules take part in the deletion of a work order (EVM-060 AC2, AC3; SR-AUTHZ-10, SR-API-06, SR-ERR-01;
 * domain-model.md → "Zlecenie"). `work-orders` does not depend on `payments`: `payments` registers an implementation here (the
 * milestones `invoiced` block the deletion, the `paid` ones need a step-up) — the dependency is inverted, there is no cycle.
 *
 * Rules of an implementation (the service relies on them):
 * - `assess` runs UNDER THE LOCK of the order (`FOR NO KEY UPDATE`, the row every command of the module of the dependents locks first),
 *   in the transaction of the command, BEFORE anything is written, and reads the database only (no external I/O);
 * - it answers with two booleans — never a count, an amount, a name or an identifier of a dependent: the answer to the caller is a
 *   code (`has_active_dependents`, `step_up_required`), so nothing about the dependents leaks;
 * - it answers for EVERY state it can read: a state it does not know is `blocked` (fail closed);
 * - the order of the calls is fixed: ascending `order`, then `name`; two implementations cannot share a name.
 * The registry fails closed: with nobody registered, or with an implementation that throws or answers with something else than the two
 * booleans, the deletion is not decided (`500`, nothing written) — never allowed.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';
import type { EventContext } from '../../platform/events/event-bus.ts';
import type { Principal } from '../../platform/http/principal.ts';
import type { DeletionAssessment } from './domain/work-order-deletion.ts';

export interface DeletionContext {
  readonly workOrderId: string;
  readonly principal: Principal;
  readonly now: Date;
  readonly request: EventContext;
}

export interface WorkOrderDeletionParticipant {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first. */
  readonly order: number;
  assess(tx: Kysely<Database>, context: DeletionContext): Promise<DeletionAssessment>;
}

/** The registry the participants announce themselves to; the service takes them in the fixed order. */
export class WorkOrderDeletionRegistry {
  readonly #participants = new Map<string, WorkOrderDeletionParticipant>();

  register(participant: WorkOrderDeletionParticipant): void {
    if (this.#participants.has(participant.name)) throw new Error(`deletion participant ${participant.name} is already registered`);
    this.#participants.set(participant.name, participant);
  }

  ordered(): WorkOrderDeletionParticipant[] {
    return [...this.#participants.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  }

  /** The names of the registered participants (a test and a diagnosis; no behaviour depends on them). */
  names(): string[] {
    return this.ordered().map((participant) => participant.name);
  }

  /**
   * The assessment of every participant, in order. Fails closed: an empty registry, a participant that throws or one that answers with
   * something else than two booleans is an `Error` (the command answers `500` and rolls back), never a permission to delete.
   */
  async assessAll(tx: Kysely<Database>, context: DeletionContext): Promise<DeletionAssessment[]> {
    const participants = this.ordered();
    if (participants.length === 0) throw new Error('no deletion participant is registered');
    const assessments: DeletionAssessment[] = [];
    for (const participant of participants) {
      const assessment = await participant.assess(tx, context);
      if (typeof assessment.blocked !== 'boolean' || typeof assessment.stepUpRequired !== 'boolean') {
        throw new Error(`deletion participant ${participant.name} returned an invalid assessment`);
      }
      assessments.push({ blocked: assessment.blocked, stepUpRequired: assessment.stepUpRequired });
    }
    return assessments;
  }
}
