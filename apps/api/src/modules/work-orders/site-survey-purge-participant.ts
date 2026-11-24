/**
 * The port through which other modules take part in the automatic purge of a site survey (EVM-139 AC2; ADR-0024 pt 9; SR-PRIV-11, SR-PRIV-04): `work-orders` owns the job,
 * `media` (the files), `timeline` (the entries of the journal) and `procedures` (the free text of the stages) own their data, and `media` and `timeline` import `work-orders`, so the dependency is inverted as in
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

/** What `erase` gets: the context and the identifiers the register of deletions already holds (the union over the participants). */
export interface SurveyEraseContext extends SurveyPurgeContext {
  readonly declaredMediaAssetIds: readonly string[];
  /** The documents of the order the register holds (EVM-147; ADR-0025 pt 4). */
  readonly declaredDocumentIds: readonly string[];
}

/**
 * Thrown by `erase` when the order holds something the register was not told about (a medium committed between `identify` and `erase`, while the register was written). The
 * job rolls the survey back untouched and takes it in the next run: a transient state, no alert (SR-FILE-11).
 */
export class SurveyChangedDuringPurge extends Error {
  constructor() {
    super('site survey purge: the survey changed between the register entry and the erasure');
    this.name = 'SurveyChangedDuringPurge';
  }
}

/**
 * Thrown by `erase` when the data of the survey breaks an invariant the erasure relies on - the note of a version of a document (`change_note`) that is not `NULL`
 * (EVM-147 AC5; ADR-0025 pt 4: the application role cannot clear it, so it must never be written). FAIL CLOSED: the job rolls the survey back untouched, counts the
 * failure with the reason `code`, audits it and raises the alert `site_survey_purge_failed`. The error carries a fixed code - never a value.
 */
export class SurveyPurgeInvariantViolated extends Error {
  readonly code: 'change_note_invariant';

  constructor(code: 'change_note_invariant') {
    super(`site survey purge: an invariant of the erasure is broken (${code})`);
    this.name = 'SurveyPurgeInvariantViolated';
    this.code = code;
  }
}

/** What a participant counts for the mode `report` (EVM-147 AC5, AC6; ADR-0025 pt 4): numbers only, never an identifier or a text. */
export interface SurveyPurgeReport {
  /** The documents of the candidates (soft deleted and erased ones too). */
  readonly documents: number;
  /** The versions of their documents whose `change_note` is not `NULL` - each would stop the erasure of its survey in `enforce`. */
  readonly changeNoteViolations: number;
}

export interface SurveyPurgeIdentity {
  /** The media of the order (identifiers only). */
  readonly mediaAssetIds: readonly string[];
  /** The documents of the order - soft deleted and already erased ones too (EVM-147; identifiers only, never a title or a file name). */
  readonly documentIds: readonly string[];
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
  /**
   * @throws SurveyChangedDuringPurge when what it would erase is not what `identify` declared.
   * @throws SurveyPurgeInvariantViolated when the data breaks an invariant of the erasure (fail closed).
   */
  erase(tx: Kysely<Database>, context: SurveyEraseContext): Promise<AfterCommit | undefined>;
  /** The mode `report` (optional): what the participant would erase of the candidates, as numbers - reads only. */
  report?(db: Kysely<Database>, workOrderIds: readonly string[]): Promise<SurveyPurgeReport>;
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
