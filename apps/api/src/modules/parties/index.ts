/** Public API of the `parties` module (other modules reach it only through this file — ADR-0001). */
export { PartiesModule } from './parties.module.ts';
export { PARTY_EVENT_TYPES, type PartyEvent } from './events.ts';
export { PARTY_DIRECTORY, type PartyDirectory } from './party-directory.ts';
export { PARTY_KINDS, type PartyKind } from './domain/party.ts';
