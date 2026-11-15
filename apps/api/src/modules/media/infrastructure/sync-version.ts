/**
 * The version of a medium that the phone sees (EVM-131; ADR-0021 D4): `version + file_state_revision`. The state of the file lives in `stored_files`, so its change raises the second term
 * (trigger of the migration 0065) and leaves `version` - the `If-Match` of the panel - alone. This is the ONE expression of the application; the database writes the same sum in
 * `sync.record_change()`, and a test keeps the version of the log equal to the version of the projection.
 */
import { sql, type RawBuilder } from 'kysely';

/** For a query that names `media.media_assets` `a` (identifiers are literals, SR-INPUT-03). */
export const syncVersionOfAsset = (): RawBuilder<number> => sql<number>`(${sql.ref('a.version')} + ${sql.ref('a.file_state_revision')})`;
