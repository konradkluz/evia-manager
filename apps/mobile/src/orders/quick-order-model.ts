/**
 * Model of the quick work order form (EVM-106 AC2, AC3): pure functions that turn what the technician typed into the command of the
 * queue, validate it and look for a similar customer on the phone. Rules kept here (security plan of the story):
 * - the checks are a convenience (the patterns equal the contract, so the server has nothing to reject); the server stays the source of
 *   truth - a difference ends in "Wymaga uwagi";
 * - an error is a code of a field and a problem, never the text that was typed (the text names a person);
 * - the similar-customer lookup is local only: it compares with the customers already in the replica and sends nothing;
 * - the ids are new for every save (UUIDv7 from the CSPRNG of the session).
 */
import type { EnqueueInput } from '@evia/sync-core';
import { normalizeSearch } from './normalize';
import { isSiteType, type PhoneTemplate, type SiteType } from './templates';

export type CustomerKind = 'person' | 'company';

export const MAX_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 200;

/** Same patterns as the contract (`SyncNewCustomer`, `SyncNewSite`). */
const PHONE = /^[0-9+() -]{7,32}$/;
const POSTAL = /^\d{2}-\d{3}$/;

/** Every control character but the new line, the direction controls and the line and paragraph separators (as the server). */
const CONTROLS = /\p{Cc}|[\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;
const NOTE_CONTROLS = /(?!\n)\p{Cc}|[\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/** What the replica gives the form (allow-listed keys; flat strings). */
export interface QuickCustomer {
  readonly id: string;
  readonly kind: string;
  readonly displayName: string;
  readonly phone: string;
}
export interface QuickSite {
  readonly id: string;
  readonly siteType: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string;
}
export interface QuickOrderSource {
  readonly customers: readonly QuickCustomer[];
  readonly sites: readonly QuickSite[];
}
export const EMPTY_QUICK_SOURCE: QuickOrderSource = { customers: [], sites: [] };

export interface QuickOrderDraft {
  readonly customerMode: 'existing' | 'new';
  readonly customerId: string | null;
  readonly kind: CustomerKind;
  readonly firstName: string;
  readonly lastName: string;
  readonly companyName: string;
  readonly phone: string;
  readonly siteMode: 'existing' | 'new';
  readonly siteId: string | null;
  readonly siteType: SiteType | null;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string;
  readonly postalCode: string;
  readonly city: string;
  readonly parkingSpotNumber: string;
  readonly templateId: string | null;
  readonly title: string;
  readonly note: string;
}

export const EMPTY_DRAFT: QuickOrderDraft = {
  customerMode: 'new',
  customerId: null,
  kind: 'person',
  firstName: '',
  lastName: '',
  companyName: '',
  phone: '',
  siteMode: 'new',
  siteId: null,
  siteType: null,
  street: '',
  buildingNumber: '',
  apartmentNumber: '',
  postalCode: '',
  city: '',
  parkingSpotNumber: '',
  templateId: null,
  title: '',
  note: '',
};

/** The draft at the moment the form opens: nothing on the phone for a part -> straight to "Nowy klient" / "Nowa" (empty state of M-10). */
export function initialDraft(source: QuickOrderSource): QuickOrderDraft {
  return {
    ...EMPTY_DRAFT,
    customerMode: source.customers.length > 0 ? 'existing' : 'new',
    siteMode: source.sites.length > 0 ? 'existing' : 'new',
  };
}

/** Whether the technician typed or chose anything (the "Odrzucić zlecenie?" question). */
export function hasInput(draft: QuickOrderDraft): boolean {
  return (
    draft.customerId !== null ||
    draft.siteId !== null ||
    draft.templateId !== null ||
    [
      draft.firstName,
      draft.lastName,
      draft.companyName,
      draft.phone,
      draft.street,
      draft.buildingNumber,
      draft.apartmentNumber,
      draft.postalCode,
      draft.city,
      draft.parkingSpotNumber,
      draft.title,
      draft.note,
    ].some((value) => value.trim() !== '')
  );
}

export type QuickField =
  | 'customer'
  | 'firstName'
  | 'lastName'
  | 'companyName'
  | 'phone'
  | 'site'
  | 'siteType'
  | 'street'
  | 'buildingNumber'
  | 'apartmentNumber'
  | 'postalCode'
  | 'city'
  | 'parkingSpotNumber'
  | 'template'
  | 'title'
  | 'note';
export type QuickProblem = 'required' | 'single_word' | 'format' | 'too_long' | 'invalid';
export interface QuickError {
  readonly field: QuickField;
  readonly problem: QuickProblem;
}

/** One line: NFC, control characters removed, spaces collapsed, trimmed. */
export function cleanLine(raw: string): string {
  return raw.normalize('NFC').replace(CONTROLS, ' ').replace(/\s+/gu, ' ').trim();
}

function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const points = (text: string): number => Array.from(text).length;

/** The note as the server will store it (NFC, LF, no control characters); `null` = lone surrogate. */
export function cleanNote(raw: string): string | null {
  if (!wellFormed(raw)) return null;
  return raw.normalize('NFC').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(NOTE_CONTROLS, '').trim();
}

/** A phone number as E.164 for the comparison only (Poland is the default country); `null` when it has no usable digits. */
export function phoneKey(raw: string): string | null {
  const text = raw.trim();
  const digits = text.replace(/\D/gu, '');
  if (digits.length < 7) return null;
  if (text.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 9) return `+48${digits}`;
  if (digits.length === 11 && digits.startsWith('48')) return `+${digits}`;
  return `+${digits}`;
}

/** The name of the new customer as the contract carries it (`displayName`), or `null` while it is incomplete. */
export function customerName(draft: Pick<QuickOrderDraft, 'kind' | 'firstName' | 'lastName' | 'companyName'>): string | null {
  if (draft.kind === 'company') {
    const name = cleanLine(draft.companyName);
    return name === '' ? null : name;
  }
  const first = cleanLine(draft.firstName);
  const last = cleanLine(draft.lastName);
  return first === '' || last === '' ? null : `${first} ${last}`;
}

/** Templates for the chosen type of site: the hint equals the type or there is none; "Pokaż wszystkie" skips the filter. */
export function templatesFor(templates: readonly PhoneTemplate[], siteType: SiteType | null, showAll: boolean): readonly PhoneTemplate[] {
  if (showAll || siteType === null) return templates;
  return templates.filter((template) => template.siteTypeHint === null || template.siteTypeHint === siteType);
}

/** The type of the place the draft points at: the chosen place of the phone or the type chosen for a new one. */
export function draftSiteType(draft: QuickOrderDraft, source: QuickOrderSource): SiteType | null {
  if (draft.siteMode === 'new') return draft.siteType;
  const site = source.sites.find((candidate) => candidate.id === draft.siteId);
  return site !== undefined && isSiteType(site.siteType) ? site.siteType : null;
}

/** Every problem of the draft, in the order of the form (the summary focuses the first). Empty = it can be saved. */
export function validateQuickOrder(
  draft: QuickOrderDraft,
  source: QuickOrderSource,
  templates: readonly PhoneTemplate[],
): readonly QuickError[] {
  const errors: QuickError[] = [];
  const add = (field: QuickField, problem: QuickProblem): void => {
    errors.push({ field, problem });
  };
  // customer
  if (draft.customerMode === 'existing') {
    if (draft.customerId === null || !source.customers.some((customer) => customer.id === draft.customerId)) add('customer', 'required');
  } else if (draft.kind === 'company') {
    const name = cleanLine(draft.companyName);
    if (name === '') add('companyName', 'required');
    else if (points(name) > MAX_NAME_LENGTH) add('companyName', 'too_long');
  } else {
    const first = cleanLine(draft.firstName);
    const last = cleanLine(draft.lastName);
    if (first === '' && last === '') {
      add('firstName', 'required');
      add('lastName', 'required');
    } else if (first === '') add('firstName', 'single_word');
    else if (last === '') add('lastName', 'single_word');
    else if (points(`${first} ${last}`) > MAX_NAME_LENGTH) add('lastName', 'too_long');
  }
  if (draft.customerMode === 'new') {
    const phone = cleanLine(draft.phone);
    if (phone === '') add('phone', 'required');
    else if (!PHONE.test(phone) || phoneKey(phone) === null) add('phone', 'format');
  }
  // site
  if (draft.siteMode === 'existing') {
    if (draft.siteId === null || !source.sites.some((site) => site.id === draft.siteId)) add('site', 'required');
  } else {
    if (draft.siteType === null) add('siteType', 'required');
    const street = cleanLine(draft.street);
    if (street === '') add('street', 'required');
    else if (points(street) > 200) add('street', 'too_long');
    const building = cleanLine(draft.buildingNumber);
    if (building === '') add('buildingNumber', 'required');
    else if (points(building) > 20) add('buildingNumber', 'too_long');
    if (points(cleanLine(draft.apartmentNumber)) > 20) add('apartmentNumber', 'too_long');
    const postal = cleanLine(draft.postalCode);
    if (postal === '') add('postalCode', 'required');
    else if (!POSTAL.test(postal)) add('postalCode', 'format');
    const city = cleanLine(draft.city);
    if (city === '') add('city', 'required');
    else if (points(city) > 100) add('city', 'too_long');
    if (draft.siteType === 'multi_family_garage' && points(cleanLine(draft.parkingSpotNumber)) > 20) add('parkingSpotNumber', 'too_long');
  }
  // template, title, note
  if (draft.templateId === null || !templates.some((template) => template.id === draft.templateId)) add('template', 'required');
  const title = cleanLine(draft.title);
  if (title === '') add('title', 'required');
  else if (points(title) > MAX_TITLE_LENGTH) add('title', 'too_long');
  const note = cleanNote(draft.note);
  if (note === null) add('note', 'invalid');
  else if (points(note) > MAX_NOTE_LENGTH) add('note', 'too_long');
  return errors;
}

export type BuildQuickResult =
  | { readonly ok: true; readonly input: EnqueueInput; readonly workOrderId: string }
  | { readonly ok: false; readonly errors: readonly QuickError[] };

/**
 * The command for the queue: `CreateQuickWorkOrder`, version 1, with NEW ids for the order and for a new customer and place (UUIDv7
 * from the CSPRNG of the session); an existing customer or place is only referred to by its id. The place carries the number of the
 * apartment and of the parking spot only when typed, and the spot only for a garage.
 */
export function buildQuickOrderInput(
  draft: QuickOrderDraft,
  source: QuickOrderSource,
  templates: readonly PhoneTemplate[],
  newId: () => string,
): BuildQuickResult {
  const errors = validateQuickOrder(draft, source, templates);
  if (errors.length > 0) return { ok: false, errors };
  const workOrderId = newId();
  const payload: Record<string, unknown> = {
    workOrderId,
    templateId: draft.templateId,
    title: cleanLine(draft.title),
  };
  if (draft.customerMode === 'existing') payload['customerId'] = draft.customerId;
  else {
    payload['newCustomer'] = {
      id: newId(),
      kind: draft.kind,
      displayName: customerName(draft),
      phone: cleanLine(draft.phone),
    };
  }
  if (draft.siteMode === 'existing') payload['siteId'] = draft.siteId;
  else {
    const apartment = cleanLine(draft.apartmentNumber);
    const spot = cleanLine(draft.parkingSpotNumber);
    payload['newSite'] = {
      id: newId(),
      siteType: draft.siteType,
      street: cleanLine(draft.street),
      buildingNumber: cleanLine(draft.buildingNumber),
      ...(apartment === '' ? {} : { apartmentNumber: apartment }),
      postalCode: cleanLine(draft.postalCode),
      city: cleanLine(draft.city),
      ...(draft.siteType === 'multi_family_garage' && spot !== '' ? { parkingSpotNumber: spot } : {}),
    };
  }
  const note = cleanNote(draft.note) ?? '';
  if (note !== '') payload['note'] = note;
  return { ok: true, workOrderId, input: { type: 'CreateQuickWorkOrder', commandVersion: 1, payload } };
}

/** The name of a customer the way the search compares it: no case, no Polish letters, one space. */
export function nameKey(raw: string): string {
  return normalizeSearch(cleanLine(raw));
}

/**
 * Customers of the phone that look like the new one (AC3): the same phone number (E.164) or the same name (no Polish letters, no
 * case). Purely local - the replica only; a hint, never a block (the server deduplicates nothing). At most three.
 */
export function findSimilarCustomers(
  draft: Pick<QuickOrderDraft, 'customerMode' | 'kind' | 'firstName' | 'lastName' | 'companyName' | 'phone'>,
  customers: readonly QuickCustomer[],
): readonly QuickCustomer[] {
  if (draft.customerMode !== 'new') return [];
  const phone = phoneKey(draft.phone);
  const name = customerName(draft);
  const wanted = name === null ? null : nameKey(name);
  if (phone === null && wanted === null) return [];
  return customers
    .filter((customer) => {
      if (phone !== null && phoneKey(customer.phone) === phone) return true;
      return wanted !== null && customer.displayName !== '' && nameKey(customer.displayName) === wanted;
    })
    .slice(0, 3);
}
