/** The implementation of the `PaymentMilestoneDirectory` facade (see `milestone-directory.ts`): one query in the transaction of the caller. */
import { Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { milestoneNames } from '../infrastructure/milestone-reader.ts';
import { paymentTables } from '../infrastructure/tables.ts';
import type { PaymentMilestoneDirectory } from '../milestone-directory.ts';

@Injectable()
export class PaymentMilestoneDirectoryService implements PaymentMilestoneDirectory {
  namesOf(tx: Kysely<Database>, workOrderId: string, milestoneIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    return milestoneNames(paymentTables(tx), workOrderId, [...new Set(milestoneIds)]);
  }
}
