/** Entry point `@evia/contracts`: types and the fetch client generated from the contract (ADR-0004). */
export * from '../generated/index.ts';
export { client } from '../generated/client.gen.ts';
export { createClient, createConfig, type Client, type Config } from '../generated/client/index.ts';
export { SYNC_PROJECTIONS, parseSyncChange, type ParsedSyncChange, type SyncProjection, type SyncProjectionType } from './sync.ts';
