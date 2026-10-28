/**
 * The neutral values of an anonymized customer (EVM-041 AC4; SR-DATA-08; domain-model.md -> "Usuwanie danych"). Pure; no database.
 * A person keeps its `kind` and gets "Klient" / "zanonimizowany" (so the display name is "Klient zanonimizowany"); a company gets the
 * company name "Klient zanonimizowany". The tax id, the contact person, the e-mail, the address and the notes are EMPTY (neutral = no
 * value); the telephone column is NOT NULL and has a format, so it gets the domain constant below - it is not a real number (the
 * panel shows "-" for an anonymized customer). The database enforces the same values with the CHECK `customers_anonymized_neutral`
 * (migration 0043); a test keeps the two equal.
 */
import type { CustomerKind } from './customer.ts';

/** The display name of an anonymized customer. */
export const ANONYMIZED_DISPLAY_NAME = 'Klient zanonimizowany';

/** The telephone of an anonymized customer: a domain constant, not a number of anybody. */
export const ANONYMIZED_PHONE = '+48000000000';

export interface NeutralCustomerValues {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly companyName: string | null;
  readonly phone: string;
}

/** The names and the telephone of the anonymized customer of a kind; every other personal column is NULL. */
export function neutralValuesOf(kind: CustomerKind): NeutralCustomerValues {
  return kind === 'person'
    ? { firstName: 'Klient', lastName: 'zanonimizowany', companyName: null, phone: ANONYMIZED_PHONE }
    : { firstName: null, lastName: null, companyName: ANONYMIZED_DISPLAY_NAME, phone: ANONYMIZED_PHONE };
}
