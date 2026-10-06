/**
 * Polish labels of the catalogue vocabularies (docs/product/service-catalog.md § 1, § 6, § 7; EVM-019 AC4). The API sends
 * stable `snake_case` values; this is where the panel turns them into words. A `Record` over the contract type makes a new
 * value of the contract a compile error here until it has a label. The consumer is the new-work-order form (EVM-022); it
 * sits next to the i18n catalogue (not inside it) so that the "every key is used" check of `pl.ts` keeps its meaning.
 */
import type { Confidentiality, PartyKind, ServiceCategory, SiteType, WaitingOn } from '@evia/contracts';

export const siteTypeLabels: Readonly<Record<SiteType, string>> = {
  single_family_house: 'Dom jednorodzinny',
  multi_family_garage: 'Garaż w budynku wielorodzinnym',
  commercial: 'Obiekt komercyjny',
  other: 'Inny',
};

export const partyKindLabels: Readonly<Record<PartyKind, string>> = {
  building_administration: 'Administracja',
  property_manager: 'Zarządca',
  housing_community: 'Wspólnota / spółdzielnia',
  designer: 'Projektant',
  fire_safety_expert: 'Rzeczoznawca ppoż',
  technical_expert: 'Rzeczoznawca (ekspertyza)',
  distribution_system_operator: 'OSD',
  subcontractor: 'Podwykonawca',
  supplier: 'Dostawca',
  other: 'Inny',
};

export const serviceCategoryLabels: Readonly<Record<ServiceCategory, string>> = {
  equipment: 'Urządzenia',
  installation: 'Instalacja i montaż',
  formal: 'Formalności i uzgodnienia',
  engineering: 'Projekt i ekspertyzy',
  acceptance: 'Pomiary i odbiór',
  other: 'Inne',
};

export const confidentialityLabels: Readonly<Record<Confidentiality, string>> = {
  identity_data: 'Dane identyfikacyjne osób',
  building_security: 'Bezpieczeństwo budynku',
  standard: 'Standardowy',
};

export const waitingOnLabels: Readonly<Record<WaitingOn, string>> = {
  customer: 'Klient',
  party: 'Strona',
};
