/**
 * The port through which other modules take part in the automatic purge of a site survey (EVM-139 AC2; ADR-0024 pt 9; SR-PRIV-11, SR-PRIV-04): `work-orders` owns the job,
 * `media` (the files) and `timeline` (the entries of the journal) own their data, and `media` and `timeline` import `work-orders`, so the dependency is inverted as in
 * `WorkOrderDeletionRegistry` - there is no cycle.
 *
 * Rules of an implementation (the job relies on them):
 * - both methods run in the transaction of the job, with the row of the order LOCKED (`FOR NO KEY UPDATE`);
 * - `identify` runs FIRST and reads only: it names the identifiers the register of deletions must hold BEFORE anything is changed (never a name, a description or a
 *   text) and says whether the participant holds the location of the survey (a document of the location, say);
 * - `erase` runs AFTER the register wrote its object and does the participant's part of the erasure in the database; the work on the storage (objects) it hands back as a
 *   function the job calls AFTER the commit - a failure of that function must leave the state that the sweep of the worker can finish (EVM-051);
 * - the order of the calls is fixed: ascending `order`, then `name`; two implementations cannot share a name; with nobody registered the purge does not run (fail closed).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export interface SurveyPurgeContext {
  readonly workOrderId: string;
  /** The location of the survey; `null` when the survey has none. */
  readonly siteId: string | null;
  readonly now: Date;
}

export interface SurveyPurgeIdentity {
  /** The media of the order (identifiers only). */
  readonly mediaAssetIds: readonly string[];
  /** `true` when the participant holds something that points at the location of the survey. */
  readonly holdsSite: boolean;
}

/** Work on the storage after the commit; it may fail - the state of the database is then finished by the sweep of the worker. */
export type AfterCommit = () => Promise<void>;

export interface SiteSurveyPurgeParticipant {
  /** Unique, stable name (the tie-break of the order and the key of the registry). */
  readonly name: string;
  /** Position in the sequence; the lower runs first. */
  readonly order: number;
  identify(tx: Kysely<Database>, context: SurveyPurgeContext): Promise<SurveyPurgeIdentity>;
  erase(tx: Kysely<Database>, context: SurveyPurgeContext): Promise<AfterCommit | undefined>;
}

/** The registry the participants announce themselves to; the job takes them in the fixed order. */
export class SiteSurveyPurgeRegistry {
  readonly #participants = new Map<string, SiteSurveyPurgeParticipant>();

  register(participant: SiteSurveyPurgeParticipant): void {
    if (this.#participants.has(participant.name)) throw new Error(`purge participant ${participant.name} is already registered`);
    this.#participants.set(participant.name, participant);
  }

  /** @throws Error when nobody is registered: the purge must not run without the participants that hold the files and the text (fail closed). */
  ordered(): SiteSurveyPurgeParticipant[] {
    const participants = [...this.#participants.values()].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
    if (participants.length === 0) throw new Error('no site survey purge participant is registered');
    return participants;
  }

  /** The names of the registered participants (a test and a diagnosis; no behaviour depends on them). */
  names(): string[] {
    return [...this.#participants.values()].map((participant) => participant.name).sort();
  }
}
