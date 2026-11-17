/**
 * Keys of the Polish catalogue of the site survey form that are chosen by data (the field and the problem of a check). Written out as
 * literals so that the catalogue test can see every key is used (no dead copy).
 */
import type { SurveyField, SurveyProblem } from '../orders/site-survey-model';

export const SURVEY_ERROR_KEYS: Readonly<Record<SurveyField, Readonly<Partial<Record<SurveyProblem, string>>>>> = {
  city: { required: 'siteSurvey.errors.city.required', too_long: 'siteSurvey.errors.city.too_long' },
  street: { required: 'siteSurvey.errors.street.required', too_long: 'siteSurvey.errors.street.too_long' },
  buildingNumber: { required: 'siteSurvey.errors.buildingNumber.required', too_long: 'siteSurvey.errors.buildingNumber.too_long' },
  apartmentNumber: { too_long: 'siteSurvey.errors.apartmentNumber.too_long' },
  postalCode: { required: 'siteSurvey.errors.postalCode.required', format: 'siteSurvey.errors.postalCode.format' },
  requesterPhone: { format: 'siteSurvey.errors.requesterPhone.format' },
};

/** The message of a problem; a combination the model never produces is the generic failure (never an empty text or a bare key). */
export const surveyErrorKey = (field: SurveyField, problem: SurveyProblem): string =>
  SURVEY_ERROR_KEYS[field][problem] ?? 'siteSurvey.errors.failed';

export const SURVEY_SAVE_PROBLEM_KEYS = {
  storage: 'siteSurvey.errors.storage',
  too_large: 'siteSurvey.errors.too_large',
  failed: 'siteSurvey.errors.failed',
} as const;
