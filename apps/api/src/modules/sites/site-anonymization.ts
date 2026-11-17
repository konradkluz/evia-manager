/**
 * The facade of `sites` for the purge of a site survey (EVM-139 AC2; ADR-0024 pt 9), in the transaction of the caller, in TWO steps because the register of deletions must
 * hold the location BEFORE it is changed: {@link SiteAnonymization.claimCreatedFor} locks the location and says whether it is to be anonymized, {@link SiteAnonymization.anonymize}
 * does it (on the same lock). `sites` does not know orders or documents, so the caller says - through `unshared`, asked AFTER the lock - whether anything else points at the
 * location. Nothing of the address leaves: the answers are verdicts.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../platform/database/database.ts';

export const SITE_ANONYMIZATION = Symbol('SITE_ANONYMIZATION');

export interface SiteClaim {
  readonly siteId: string;
  /** The survey's creator: the location was made for the survey only when the same person made it. */
  readonly createdBy: string | null;
  /** The location was made for the survey when it was created in this window (it comes before the survey: the survey names an existing site). */
  readonly createdNotBefore: Date;
  readonly createdNotAfter: Date;
  /** Asked with the location locked: `true` when no other order and no document points at it. */
  readonly unshared: () => Promise<boolean>;
}

export interface SiteAnonymization {
  /** Locks the location `FOR UPDATE` and answers `true` when it was made for the survey, is not anonymized yet and nothing else holds it. The lock stays to the end of the transaction. */
  claimCreatedFor(tx: Kysely<Database>, claim: SiteClaim): Promise<boolean>;
  /** Anonymizes and soft deletes the location claimed above (same transaction). */
  anonymize(tx: Kysely<Database>, siteId: string, actorUserId: string, now: Date): Promise<void>;
}
