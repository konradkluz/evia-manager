/**
 * The actor of an operation the SYSTEM does without a signed-in person (EVM-139: the automatic purge of site surveys by the worker). The columns `*_by` of the tables are
 * plain `uuid` (no foreign key), so a constant that belongs to no user says "the system" there, and the register of deletions carries it as the pseudonymous actor
 * (the replay needs a value for `redacted_by`). It is not a secret and not personal data; the audit trail says `actorType: system` and keeps no identifier.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-7000-8000-000000000000';
