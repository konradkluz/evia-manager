/**
 * Model of the site survey ("Wizja lokalna", EVM-137 AC1, AC2, AC4): pure functions that turn what the technician typed into the command
 * `CreateSiteSurvey`, validate it and compute the term of a survey. Rules kept here (security W5, W8 of the story):
 * - the form has an address and one optional phone of the requester - no client, template, title or note (free text would take names);
 * - the checks equal the contract (`SyncNewSite`, `requesterPhone`; the patterns are those of the quick order), the server stays the source
 *   of truth - a difference ends in "Wymaga uwagi";
 * - an error is a code of a field and a problem, never the text that was typed (the text names a place);
 * - the ids are new for every save (UUIDv7 from the CSPRNG of the session): one touch is one command.
 */
import type { EnqueueInput } from '@evia/sync-core';
import { calendarDay } from '../i18n/format';
import { cleanLine, PHONE, phoneKey, points, POSTAL } from './quick-order-model';

/** The term of a survey without a client: 90 days from its creation (decision 3 of Konrad; the server stays the source once it knows it). */
export const SURVEY_TERM_DAYS = 90;
/** From this many days left the term is a warning (flow 17, rule 3). */
export const SURVEY_WARNING_DAYS = 15;
/** The title the server gives a survey; the app never sends a title. */
export const DEFAULT_SURVEY_TITLE = 'Wizja lokalna';

const DAY_MS = 86_400_000;

export interface SurveyDraft {
  readonly city: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly apartmentNumber: string;
  readonly postalCode: string;
  readonly requesterPhone: string;
}

export const EMPTY_SURVEY_DRAFT: SurveyDraft = {
  city: '',
  street: '',
  buildingNumber: '',
  apartmentNumber: '',
  postalCode: '',
  requesterPhone: '',
};

export type SurveyField = keyof SurveyDraft;
export type SurveyProblem = 'required' | 'format' | 'too_long';
export interface SurveyError {
  readonly field: SurveyField;
  readonly problem: SurveyProblem;
}

/** Whether the technician typed anything (the question before the form is left). */
export function hasSurveyInput(draft: SurveyDraft): boolean {
  return (Object.values(draft) as string[]).some((value) => value.trim() !== '');
}

/** Every problem of the draft, in the order of the form (the summary focuses the first). Empty = it can be saved. */
export function validateSurvey(draft: SurveyDraft): readonly SurveyError[] {
  const errors: SurveyError[] = [];
  const add = (field: SurveyField, problem: SurveyProblem): void => {
    errors.push({ field, problem });
  };
  const city = cleanLine(draft.city);
  if (city === '') add('city', 'required');
  else if (points(city) > 100) add('city', 'too_long');
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
  const phone = cleanLine(draft.requesterPhone);
  if (phone !== '' && (!PHONE.test(phone) || phoneKey(phone) === null)) add('requesterPhone', 'format');
  return errors;
}

export type BuildSurveyResult =
  | { readonly ok: true; readonly input: EnqueueInput; readonly payload: Record<string, unknown>; readonly workOrderId: string }
  | { readonly ok: false; readonly errors: readonly SurveyError[] };

/**
 * The command for the queue: `CreateSiteSurvey`, version 1, with NEW ids for the survey and its place. The place is of the type `other`
 * (the contract needs a type; the office completes the place after the client is assigned). The apartment and the phone are sent only when typed.
 */
export function buildSurveyInput(draft: SurveyDraft, newId: () => string): BuildSurveyResult {
  const errors = validateSurvey(draft);
  if (errors.length > 0) return { ok: false, errors };
  const workOrderId = newId();
  const apartment = cleanLine(draft.apartmentNumber);
  const phone = cleanLine(draft.requesterPhone);
  const payload: Record<string, unknown> = {
    workOrderId,
    newSite: {
      id: newId(),
      siteType: 'other',
      street: cleanLine(draft.street),
      buildingNumber: cleanLine(draft.buildingNumber),
      ...(apartment === '' ? {} : { apartmentNumber: apartment }),
      postalCode: cleanLine(draft.postalCode),
      city: cleanLine(draft.city),
    },
    ...(phone === '' ? {} : { requesterPhone: phone }),
  };
  return { ok: true, workOrderId, payload, input: { type: 'CreateSiteSurvey', commandVersion: 1, payload } };
}

/** What a list and a detail need to know about a survey: the term and how many times it was extended. */
export interface SurveyInfo {
  readonly expiresAt: number;
  readonly extensionCount: number;
}

/** The term of a survey that is only in the queue: 90 days from the moment it was saved on the phone. */
export function pendingSurveyExpiry(createdAt: number): SurveyInfo {
  return { expiresAt: createdAt + SURVEY_TERM_DAYS * DAY_MS, extensionCount: 0 };
}

export type ExpiryState = 'normal' | 'warning' | 'today' | 'overdue';
export interface Expiry {
  readonly state: ExpiryState;
  /** Calendar days (Europe/Warsaw) from now to the term; 0 = today, negative = after the term. */
  readonly days: number;
}

/** The term as the screens show it: "Wygasa za N dni" (normal, or warning from 15 days and fewer), "Wygasa dziś", "Termin minął". */
export function expiryOf(expiresAt: number, now: number): Expiry {
  const days = calendarDay(expiresAt) - calendarDay(now);
  if (days < 0) return { state: 'overdue', days };
  if (days === 0) return { state: 'today', days };
  return { state: days <= SURVEY_WARNING_DAYS ? 'warning' : 'normal', days };
}
