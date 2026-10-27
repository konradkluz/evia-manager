/**
 * The audit event of a change of an entry (EVM-040 AC4; SR-LOG-03, SR-DATA-08): the action, the actor, the entry and the outcome - identifiers
 * and a closed list of codes, never the text of the entry, its category or the name of its stage (the trail is append-only and cannot be
 * erased, RODO art. 17). The order of the entry is a column of the entry itself, read from there by the identifier.
 */
import type { Principal } from '../../../platform/http/principal.ts';
import type { TimelineEntryEvent } from '../events.ts';

export function entryEvent(
  type: TimelineEntryEvent['type'],
  principal: Pick<Principal, 'userId'>,
  entryId: string,
  outcome: TimelineEntryEvent['outcome'],
): TimelineEntryEvent {
  return { type, actor: { type: 'user', userId: principal.userId }, outcome, objectType: 'timeline_entry', objectId: entryId };
}
