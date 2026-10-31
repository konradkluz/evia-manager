/**
 * The new customer of a quick work order from the phone (EVM-099 AC2, AC3; SR-INPUT-01, SR-INPUT-05, SR-DATA-02): the phone sends the kind, ONE display name
 * and the telephone, nothing else. The rules are the panel's (`normalizeNewCustomer`) applied to the same data: the telephone is normalised to E.164 by
 * the same function, a person's name is split at the LAST space (everything before it is the first name, the last word the surname - a single word is refused),
 * a company's name is the company name. The other fields stay empty. Pure, no database. The errors are a JSON Pointer of the payload and a code, NEVER the
 * value (the telephone and the name are personal data).
 */
import type { FieldIssue } from '../../../platform/input/field-issues.ts';
import { normalizeNewCustomer, type CustomerKind, type NewCustomer } from './customer.ts';

export interface QuickCustomerInput {
  readonly id: string;
  readonly kind: CustomerKind;
  readonly displayName: string;
  readonly phone: string;
}

export type QuickCustomerResult =
  { readonly ok: true; readonly customer: NewCustomer } | { readonly ok: false; readonly errors: readonly FieldIssue[] };

const POINTER_ROOT = '/newCustomer';
const NAME_POINTERS = new Set(['/firstName', '/lastName', '/companyName']);

/** Splits the name of a person at the last space: `[first name, surname]`, or `undefined` for a single word. */
export function splitPersonName(displayName: string): readonly [string, string] | undefined {
  const name = displayName.normalize('NFC').trim();
  const cut = name.lastIndexOf(' ');
  if (cut === -1) return undefined;
  const first = name.slice(0, cut).trim();
  const last = name.slice(cut + 1).trim();
  return first === '' || last === '' ? undefined : [first, last];
}

export function normalizeQuickCustomer(input: QuickCustomerInput): QuickCustomerResult {
  const person = input.kind === 'person';
  const parts = person ? splitPersonName(input.displayName) : undefined;
  if (person && parts === undefined) return { ok: false, errors: [{ pointer: `${POINTER_ROOT}/displayName`, code: 'single_word_name' }] };
  const normalized = normalizeNewCustomer({
    id: input.id,
    kind: input.kind,
    phone: input.phone,
    ...(parts === undefined ? { companyName: input.displayName } : { firstName: parts[0], lastName: parts[1] }),
  });
  if (normalized.ok) return normalized;
  const seen = new Set<string>();
  const errors: FieldIssue[] = [];
  for (const issue of normalized.errors) {
    const pointer = NAME_POINTERS.has(issue.pointer) ? `${POINTER_ROOT}/displayName` : `${POINTER_ROOT}${issue.pointer}`;
    if (!seen.has(`${pointer}#${issue.code}`)) errors.push({ pointer, code: issue.code });
    seen.add(`${pointer}#${issue.code}`);
  }
  return { ok: false, errors };
}
