/**
 * 0064 - the moment a device was invalidated (EVM-095; P2, SR-SESS-07, SR-MOB-04). Expand only: one nullable column the code that is still running never reads.
 *
 * - `identity.devices.invalidated_at`: set when the phone is logged out, ordered to wipe or hit by an event of the account (deactivation, role, password or
 *   second step). The retention of the register (90 days) counts from the LATER of the last contact and this moment, so a device that was ordered to wipe 5 days ago
 *   keeps its record - and with it the signal `401 device_wipe_required` - however long it had been silent before. `last_contact_at` is not touched (the panel shows it).
 */
import { sql, type Kysely } from 'kysely';
import type { Database } from '../platform/database/database.ts';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`alter table identity.devices add column invalidated_at timestamptz`.execute(db);
}
