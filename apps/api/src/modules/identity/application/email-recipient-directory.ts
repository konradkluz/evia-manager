/**
 * What the composer of another module may ask `identity` to send a message of its own (the facade of ADR-0001; EVM-140 AC1; SR-DATA-01, SR-DATA-03): to lock the
 * account of the recipient (the first lock of the unit of work of the outbox) and to read, at the moment of SENDING, the address and the role of an ACTIVE account.
 * It exists for the composers of the outbox ONLY: the outbox holds identifiers, never an address, so the address is read here, in the transaction of the job, and
 * lives in memory until the message is handed over. An account that is invited, deactivated, deleted or missing is `undefined` - one answer.
 */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export interface ActiveRecipient {
  readonly address: string;
  readonly role: 'administrator' | 'editor' | 'read_only';
}

@Injectable()
export class EmailRecipientDirectory {
  /** `SELECT ... FOR UPDATE` of the account - the first lock of the unit of work of the outbox. */
  async lock(tx: Kysely<Database>, userId: string): Promise<void> {
    await findUserById(identityTables(tx), userId, true);
  }

  async findActive(tx: Kysely<Database>, userId: string): Promise<ActiveRecipient | undefined> {
    const user = await findUserById(identityTables(tx), userId);
    if (user === undefined || user.deletedAt !== null || user.status !== 'active') return undefined;
    return { address: user.email, role: user.role };
  }
}
