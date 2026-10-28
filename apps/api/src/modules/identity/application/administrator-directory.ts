/**
 * What other modules may ask `identity` about the Administrators (the facade of ADR-0001; EVM-049 AC2): the identifiers of the ACTIVE ones —
 * an invited, a deactivated and a deleted account is not among them. Never an address, a name or a status: the recipient of an alert is chosen
 * by identifier, and the address is read by the composer at the moment of sending (SR-DATA-01).
 */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { listActiveAdministratorIds } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

@Injectable()
export class AdministratorDirectory {
  /** @param tx the transaction of the caller (the recipients are chosen in the transaction of the change the alert tells about) */
  listActiveIds(tx: Kysely<Database>): Promise<string[]> {
    return listActiveAdministratorIds(identityTables(tx));
  }
}
