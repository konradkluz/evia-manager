/**
 * Vocabularies and code rules of the catalog (docs/product/service-catalog.md § 1, § 6, § 7; domain-model.md → Konwencje
 * danych). The values are fixed in code (a new value is a code change, an *expand*); the same values are CHECK
 * constraints in the database and `enum`s of the contract. Labels are Polish and live in the panel, never here.
 */

/** Stable configuration code: `snake_case`, 2–64 characters (domain-model.md → Kody konfiguracji). */
export const CONFIG_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const isConfigCode = (value: unknown): value is string => typeof value === 'string' && CONFIG_CODE_PATTERN.test(value);

export const SERVICE_CATEGORIES = ['equipment', 'installation', 'formal', 'engineering', 'acceptance', 'other'] as const;
export const SITE_TYPES = ['single_family_house', 'multi_family_garage', 'commercial', 'other'] as const;
export const PARTY_KINDS = [
  'building_administration',
  'property_manager',
  'housing_community',
  'designer',
  'fire_safety_expert',
  'technical_expert',
  'distribution_system_operator',
  'subcontractor',
  'supplier',
  'other',
] as const;
export const WAITING_ON = ['customer', 'party'] as const;
export const CONFIDENTIALITIES = ['identity_data', 'building_security', 'standard'] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type SiteType = (typeof SITE_TYPES)[number];
export type PartyKind = (typeof PARTY_KINDS)[number];
export type WaitingOn = (typeof WAITING_ON)[number];
export type Confidentiality = (typeof CONFIDENTIALITIES)[number];

/** Upper bound of every list of the configuration (the API returns a whole list, api-guidelines.md → Paginacja). */
export const MAX_LIST_ITEMS = 100;
