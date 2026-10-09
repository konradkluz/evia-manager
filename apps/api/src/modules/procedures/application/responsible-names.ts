/**
 * The display names of the people responsible for the stages of one order, through the facade of `identity` (SR-DATA-03: id and name
 * only). An order may name more people than one lookup of the facade takes (it refuses a batch above its limit rather than truncate),
 * so the identifiers are split into batches — each user once, however many stages name them.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import { DISPLAY_NAMES_BATCH_LIMIT, type UserDirectory } from '../../identity/index.ts';
import type { ResponsibleNames } from './procedure-representation.ts';

export async function responsibleNamesOf(
  users: UserDirectory,
  handle: Kysely<Database>,
  ids: readonly string[],
): Promise<ResponsibleNames> {
  const distinct = [...new Set(ids)];
  const names = new Map<string, string>();
  for (let start = 0; start < distinct.length; start += DISPLAY_NAMES_BATCH_LIMIT) {
    const batch = await users.displayNamesOf(distinct.slice(start, start + DISPLAY_NAMES_BATCH_LIMIT), handle);
    for (const [id, name] of batch) names.set(id, name);
  }
  return names;
}
