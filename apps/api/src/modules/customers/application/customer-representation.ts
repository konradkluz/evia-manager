/**
 * The representation of a customer as the contract has it (SR-DATA-03): the fields of the contract only — never the search text,
 * the sort name or the people who created and changed it — parsed with the schema of the contract before it leaves.
 */
import type { Customer } from '@evia/contracts';
import { zCustomer } from '@evia/contracts/zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { CustomerRow } from '../infrastructure/customer-store.ts';

const present = <K extends string>(key: K, value: string | null): { [P in K]?: string } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: string };

export function toCustomer(row: CustomerRow): Customer {
  const address =
    row.street === null || row.building_number === null || row.postal_code === null || row.city === null
      ? undefined
      : {
          street: row.street,
          buildingNumber: row.building_number,
          ...present('apartmentNumber', row.apartment_number),
          postalCode: row.postal_code,
          city: row.city,
        };
  const customer = {
    id: row.id,
    kind: row.kind,
    ...present('firstName', row.first_name),
    ...present('lastName', row.last_name),
    ...present('companyName', row.company_name),
    ...present('taxId', row.tax_id),
    ...present('contactPersonName', row.contact_person_name),
    phone: row.phone,
    ...present('email', row.email),
    ...(address === undefined ? {} : { postalAddress: address }),
    ...present('notes', row.notes),
    displayName: row.display_name,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  const checked = zCustomer.safeParse(customer);
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}
