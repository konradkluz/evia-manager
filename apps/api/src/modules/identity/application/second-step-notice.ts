/**
 * What a change of the second step from the account sends (EVM-028 AC3, AC5; SR-AUTH-10, SR-AUTH-15, SR-LOG-07): e-mail 5 to the address of the account (the
 * kind of the change only — never the name of a key, an address or who did it) and, when the account is an Administrator's, the alert 9 to EVERY active
 * Administrator, the one whose account changed included. Both are rows of the outbox written in the transaction of the change: they exist exactly when it
 * committed.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { enqueueEmail } from '../../../platform/email/email-outbox.ts';
import type { SecondStepChange } from '../domain/email-templates.ts';
import { listActiveAdministratorIds } from '../infrastructure/queries.ts';
import { identityTables, type UsersTable } from '../infrastructure/tables.ts';

export async function noticeSecondStepChange(
  transaction: Kysely<Database>,
  account: { readonly userId: string; readonly role: UsersTable['role'] },
  change: SecondStepChange,
  now: Date,
  options: { readonly alertAdministrators?: boolean } = {},
): Promise<void> {
  await enqueueEmail(transaction, { kind: 'mfa_changed', variant: change, recipientUserId: account.userId, now });
  if (account.role !== 'administrator' || options.alertAdministrators === false) return;
  for (const recipientUserId of await listActiveAdministratorIds(identityTables(transaction))) {
    await enqueueEmail(transaction, { kind: 'administrator_alert', variant: 'administrator_second_step_changed', recipientUserId, now });
  }
}
