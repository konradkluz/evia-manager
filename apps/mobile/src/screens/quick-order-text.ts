/**
 * Keys of the Polish catalogue of the quick work order form that are chosen by data (the field and the problem of a check, the type of a
 * site, the Polish plural form). Written out as literals so that the catalogue test can see every key is used (no dead copy).
 */
import type { QuickField, QuickProblem } from '../orders/quick-order-model';
import type { SiteType } from '../orders/templates';

export const ERROR_KEYS: Readonly<Record<QuickField, Readonly<Partial<Record<QuickProblem, string>>>>> = {
  customer: { required: 'quickOrder.errors.customer.required' },
  firstName: { required: 'quickOrder.errors.firstName.required', single_word: 'quickOrder.errors.firstName.single_word' },
  lastName: {
    required: 'quickOrder.errors.lastName.required',
    single_word: 'quickOrder.errors.lastName.single_word',
    too_long: 'quickOrder.errors.lastName.too_long',
  },
  companyName: { required: 'quickOrder.errors.companyName.required', too_long: 'quickOrder.errors.companyName.too_long' },
  phone: { required: 'quickOrder.errors.phone.required', format: 'quickOrder.errors.phone.format' },
  site: { required: 'quickOrder.errors.site.required' },
  siteType: { required: 'quickOrder.errors.siteType.required' },
  street: { required: 'quickOrder.errors.street.required', too_long: 'quickOrder.errors.street.too_long' },
  buildingNumber: { required: 'quickOrder.errors.buildingNumber.required', too_long: 'quickOrder.errors.buildingNumber.too_long' },
  apartmentNumber: { too_long: 'quickOrder.errors.apartmentNumber.too_long' },
  postalCode: { required: 'quickOrder.errors.postalCode.required', format: 'quickOrder.errors.postalCode.format' },
  city: { required: 'quickOrder.errors.city.required', too_long: 'quickOrder.errors.city.too_long' },
  parkingSpotNumber: { too_long: 'quickOrder.errors.parkingSpotNumber.too_long' },
  template: { required: 'quickOrder.errors.template.required' },
  title: { required: 'quickOrder.errors.title.required', too_long: 'quickOrder.errors.title.too_long' },
  note: { too_long: 'quickOrder.errors.note.too_long', invalid: 'quickOrder.errors.note.invalid' },
};

/** The message of a problem; a combination the model never produces is the generic failure (never an empty text or a bare key). */
export const errorKey = (field: QuickField, problem: QuickProblem): string => ERROR_KEYS[field][problem] ?? 'quickOrder.errors.failed';

export const SAVE_PROBLEM_KEYS = {
  storage: 'quickOrder.errors.storage',
  too_large: 'quickOrder.errors.too_large',
  failed: 'quickOrder.errors.failed',
} as const;

export const SITE_TYPE_KEYS: Readonly<Record<SiteType, string>> = {
  single_family_house: 'quickOrder.siteTypes.single_family_house',
  multi_family_garage: 'quickOrder.siteTypes.multi_family_garage',
  commercial: 'quickOrder.siteTypes.commercial',
  other: 'quickOrder.siteTypes.other',
};

export const PLURAL_KEYS = {
  items: { one: 'quickOrder.templateItems_one', few: 'quickOrder.templateItems_few', many: 'quickOrder.templateItems_many' },
  procedures: {
    one: 'quickOrder.templateProcedures_one',
    few: 'quickOrder.templateProcedures_few',
    many: 'quickOrder.templateProcedures_many',
  },
  milestones: {
    one: 'quickOrder.templateMilestones_one',
    few: 'quickOrder.templateMilestones_few',
    many: 'quickOrder.templateMilestones_many',
  },
} as const;
