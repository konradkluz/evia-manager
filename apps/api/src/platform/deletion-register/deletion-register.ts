/**
 * The register of deletions outside the database (EVM-040 AC3; ADR-0003, ADR-0018; SR-PRIV-04): before a text is erased (a redaction, later an
 * anonymisation) one NEW object is written to a bucket the application can only add to (`PutObject`). After a restore of the database from a
 * backup the register tells which erasures to apply again (EVM-062), so erased personal data does not return with the backup.
 *
 * The port has ONE operation, {@link DeletionRegister.record}. It is a journal of INTENT with at-least-once semantics: an object may be written
 * and the change in the database may still fail (the object is then orphaned - harmless: applying it again erases data that was meant to be
 * erased, and the replay is idempotent). An object holds identifiers and codes only - never the text that is erased, never a name (RODO art. 17).
 * Fail closed: when the register cannot be written, the erasure does not start ({@link DeletionRegisterUnavailable}).
 */

/** The token of the port. */
export const DELETION_REGISTER = Symbol('DELETION_REGISTER');

/** What was done to the subject; the closed list grows with the stories that erase (EVM-041 adds the anonymisation of a customer). */
export const DELETION_OPERATION_CODES = ['timeline_entry_redacted'] as const;
export type DeletionOperationCode = (typeof DELETION_OPERATION_CODES)[number];

export const DELETION_SUBJECT_TYPES = ['timeline_entry'] as const;
export type DeletionSubjectType = (typeof DELETION_SUBJECT_TYPES)[number];

/** What a caller says; the identifier of the operation and the time are made by the register itself (never a value of a request). */
export interface DeletionRecord {
  readonly operationCode: DeletionOperationCode;
  readonly subjectType: DeletionSubjectType;
  readonly subjectId: string;
  /** The order the subject belongs to (`null` for a subject outside an order). */
  readonly workOrderId: string | null;
  /** The pseudonymous identifier of the person who erased: the replay needs it for the columns of the redaction (`redacted_by`). */
  readonly actorUserId: string;
}

/** What was written. */
export interface DeletionReceipt {
  /** UUIDv7 made by the server. */
  readonly operationId: string;
  readonly key: string;
}

export interface DeletionRegister {
  /** @throws DeletionRegisterUnavailable when the object was not written (not configured, refused, no answer in time) */
  record(record: DeletionRecord): Promise<DeletionReceipt>;
}

/** The register did not take the record. No text of the storage's answer: only a fixed reason (SR-LOG-02, CWE-209). */
export type UnavailableReason = 'not_configured' | 'write_failed';

export class DeletionRegisterUnavailable extends Error {
  readonly reason: UnavailableReason;

  constructor(reason: UnavailableReason) {
    super(`deletion register unavailable: ${reason}`);
    this.name = 'DeletionRegisterUnavailable';
    this.reason = reason;
  }
}
