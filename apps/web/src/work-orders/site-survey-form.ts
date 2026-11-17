import type { CreateSiteSurveyRequest, FieldError } from '@evia/contracts';
import { readDraft } from '../session/draft-store.ts';
import { EMPTY_LOCATION, locationStarted, type LocationState } from '../sites/location-section.tsx';
import { isObject, restoreLocation } from './draft-location.ts';

/** Names of the drafts of W-05 in the memory of the tab (`session/draft-store.ts`). */
export const ORDER_DRAFT = 'work-order-new';
export const SURVEY_DRAFT = 'work-order-new-survey';

/** The choice of the keeper that means "Bez opiekuna" (an id of a user is never this text). `''` is the person who is logged in. */
export const NO_KEEPER = 'none';

/** The pattern the API accepts for the phone of the requester (`400 invalid_format` otherwise). */
export const PHONE_PATTERN = /^[0-9+() -]{7,32}$/;

/**
 * What a draft of a site survey holds: the location and the keeper. The phone of the requester is never in a draft (personal data,
 * EVM-138 AC2): it lives in the state of the form only, so leaving the form drops it.
 */
export interface SurveyDraft {
  readonly location: LocationState;
  readonly keeper: string;
  /** When the draft last changed; `null` until the first change. */
  readonly savedAt: number | null;
}

export const EMPTY_SURVEY_DRAFT: SurveyDraft = { location: EMPTY_LOCATION, keeper: '', savedAt: null };

/** Fields of the form that can carry an error; the order is the order on the page (the first one gets the focus). */
export const SURVEY_FIELDS = ['site', 'phone', 'keeper'] as const;
export type SurveyField = (typeof SURVEY_FIELDS)[number];
export type SurveyFieldErrors = Partial<Record<SurveyField, string>>;

const POINTERS: Readonly<Record<string, SurveyField>> = {
  '/siteId': 'site',
  '/requesterPhone': 'phone',
  '/assigneeUserId': 'keeper',
};

/** The field an error of the server points at (`undefined` for a pointer the form has no field for). */
export const surveyFieldOf = (error: FieldError): SurveyField | undefined => POINTERS[error.pointer];

/** What the person typed is a phone the API would accept (an empty field is fine: the phone is optional). */
export const phoneValid = (phone: string): boolean => phone.trim() === '' || PHONE_PATTERN.test(phone.trim());

/**
 * The body of `createSiteSurvey`: the identifier, the site and what was filled in. The title is never sent (the server names the
 * survey; nobody types a name there), an empty phone is absent, "Bez opiekuna" has no `assigneeUserId` (the API: no keeper).
 */
export function buildSurveyBody(id: string, siteId: string, phone: string, keeper: string, userId: string): CreateSiteSurveyRequest {
  const trimmed = phone.trim();
  const keeperId = keeper === '' ? userId : keeper;
  return {
    id,
    siteId,
    ...(trimmed === '' ? {} : { requesterPhone: trimmed }),
    ...(keeper === NO_KEEPER ? {} : { assigneeUserId: keeperId }),
  };
}

/** The same content (everything but the identifier) is the same request: a retry of it keeps the `id` and the key. In memory only. */
export const surveyFingerprint = (body: CreateSiteSurveyRequest): string => JSON.stringify({ ...body, id: undefined });

function parse(stored: string | undefined): Record<string, unknown> | null {
  if (stored === undefined) return null;
  try {
    const value = JSON.parse(stored) as unknown;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The location typed in the other kind of the form (W-05 keeps it when the kind changes: "wpisana lokalizacja zostaje w szkicu").
 * `undefined` — nothing to take over.
 */
export function readDraftLocation(userId: string, form: string): LocationState | undefined {
  const value = parse(readDraft(userId, form));
  const location = value === null ? undefined : restoreLocation(value.location);
  return location !== undefined && locationStarted(location) ? location : undefined;
}

/** The draft of a site survey; without one, the location of the draft of an order (and the default keeper). */
export function restoreSurveyDraft(userId: string): SurveyDraft {
  const value = parse(readDraft(userId, SURVEY_DRAFT));
  if (value !== null && typeof value.savedAt === 'number' && typeof value.keeper === 'string') {
    const location = restoreLocation(value.location);
    if (location !== undefined) return { location, keeper: value.keeper, savedAt: value.savedAt };
  }
  return { ...EMPTY_SURVEY_DRAFT, location: readDraftLocation(userId, ORDER_DRAFT) ?? EMPTY_LOCATION };
}
