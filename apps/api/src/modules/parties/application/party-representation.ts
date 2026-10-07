/**
 * The representation of a party as the contract has it (SR-DATA-03): the fields of the contract only — never the search text or
 * the people who created and changed it — parsed with the schema of the contract before it leaves.
 */
import type { Party } from '@evia/contracts';
import { zParty } from '@evia/contracts/zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { PartyRow } from '../infrastructure/party-store.ts';

const present = <K extends string>(key: K, value: string | null): { [P in K]?: string } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: string };

export function toParty(row: PartyRow): Party {
  const party = {
    id: row.id,
    kind: row.kind,
    legalForm: row.legal_form,
    displayName: row.display_name,
    ...present('contactPersonName', row.contact_person_name),
    ...present('phone', row.phone),
    ...present('email', row.email),
    ...present('notes', row.notes),
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  const checked = zParty.safeParse(party);
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}
