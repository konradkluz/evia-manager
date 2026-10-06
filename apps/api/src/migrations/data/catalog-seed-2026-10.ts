/**
 * Starting data of the catalogue, frozen at the state accepted by Konrad on 2026-10-03 (docs/product/service-catalog.md
 * § 2–6; EVM-002 AC6, EVM-019 AC1). This file belongs to the migration `0008_catalog_seed` and is deliberately
 * independent of the `catalog` module (no import from it): a later change of the code of the module must never change
 * what a historical migration writes. A change of the starting data is a NEW data migration with its own frozen copy
 * (the story EVM-019 AC6). Synthetic configuration only: no customers, addresses, PPE numbers or amounts — payment plans
 * hold percentages. Positions are the order in the arrays (1-based). The consistency of this data is checked by the
 * gate (`validateCatalogConfig`, test EVM-019 AC3).
 */

export interface SeedDocumentKind {
  readonly code: string;
  readonly name: string;
  readonly confidentiality: string;
}

export interface SeedServiceItem {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly parameterSetCode: string | null;
  readonly procedureTemplateCodes: readonly string[];
}

export interface SeedStage {
  readonly code: string;
  readonly name: string;
  readonly defaultWaitingOn: 'customer' | 'party' | null;
  readonly defaultWaitingOnPartyKind: string | null;
  readonly outputDocumentKindCodes: readonly string[];
}

export interface SeedProcedureTemplate {
  readonly code: string;
  readonly name: string;
  readonly stages: readonly SeedStage[];
}

export interface SeedTemplateItem {
  readonly serviceItemCode: string;
  readonly defaultQuantity: number;
  readonly defaultParameters: Readonly<Record<string, string | number | boolean>>;
}

export interface SeedPaymentMilestone {
  readonly code: string;
  readonly name: string;
  readonly sharePercent: number;
  readonly invoiceHint: string;
  readonly paymentTermDays: number;
}

export interface SeedWorkOrderTemplate {
  readonly code: string;
  readonly name: string;
  readonly siteTypeHint: string | null;
  readonly items: readonly SeedTemplateItem[];
  readonly paymentMilestones: readonly SeedPaymentMilestone[];
}

export interface CatalogSeed {
  /** The instant written to `created_at` and `updated_at` (migrations never read the database clock). */
  readonly seededAt: string;
  readonly documentKinds: readonly SeedDocumentKind[];
  readonly procedureTemplates: readonly SeedProcedureTemplate[];
  readonly serviceItems: readonly SeedServiceItem[];
  readonly workOrderTemplates: readonly SeedWorkOrderTemplate[];
}

const stage = (
  code: string,
  name: string,
  waiting: 'customer' | { readonly party: string } | null = null,
  outputDocumentKindCodes: readonly string[] = [],
): SeedStage => ({
  code,
  name,
  defaultWaitingOn: waiting === null ? null : waiting === 'customer' ? 'customer' : 'party',
  defaultWaitingOnPartyKind: waiting === null || waiting === 'customer' ? null : waiting.party,
  outputDocumentKindCodes,
});

const item = (serviceItemCode: string, defaultParameters: SeedTemplateItem['defaultParameters'] = {}): SeedTemplateItem => ({
  serviceItemCode,
  defaultQuantity: 1,
  defaultParameters,
});

const milestone = (
  code: string,
  name: string,
  sharePercent: number,
  invoiceHint: string,
  paymentTermDays: number,
): SeedPaymentMilestone => ({ code, name, sharePercent, invoiceHint, paymentTermDays });

const GARAGE_FORMALITIES = [
  item('building_management_approval'),
  item('technical_assessment'),
  item('fire_safety_opinion'),
  item('installation_design'),
  item('dso_agreement'),
  item('supply_installation', { dedicatedCircuit: true, internalSupplyLine: true }),
] as const;

export const CATALOG_SEED_2026_10: CatalogSeed = {
  seededAt: '2026-10-06T00:00:00.000Z',

  // § 6 — document kinds with the confidentiality class
  documentKinds: [
    { code: 'power_of_attorney', name: 'Pełnomocnictwo', confidentiality: 'identity_data' },
    { code: 'dso_application', name: 'Wniosek do OSD', confidentiality: 'identity_data' },
    { code: 'connection_conditions', name: 'Warunki przyłączenia', confidentiality: 'standard' },
    { code: 'dso_agreement', name: 'Umowa / aneks z OSD', confidentiality: 'identity_data' },
    { code: 'dso_readiness_declaration', name: 'Zgłoszenie gotowości instalacji do OSD', confidentiality: 'identity_data' },
    { code: 'customer_contract', name: 'Umowa z klientem', confidentiality: 'identity_data' },
    { code: 'quote', name: 'Oferta / wycena', confidentiality: 'standard' },
    { code: 'technical_assessment', name: 'Ekspertyza techniczna', confidentiality: 'building_security' },
    { code: 'fire_safety_opinion', name: 'Opinia ppoż', confidentiality: 'building_security' },
    { code: 'installation_design', name: 'Projekt instalacji', confidentiality: 'building_security' },
    { code: 'building_documentation', name: 'Dokumentacja budynku (od administracji)', confidentiality: 'building_security' },
    { code: 'building_management_consent', name: 'Zgoda administracji / uchwała wspólnoty', confidentiality: 'standard' },
    { code: 'measurement_report', name: 'Protokół pomiarów', confidentiality: 'standard' },
    { code: 'commissioning_report', name: 'Protokół uruchomienia', confidentiality: 'standard' },
    { code: 'acceptance_report', name: 'Protokół odbioru', confidentiality: 'standard' },
    { code: 'other', name: 'Inny dokument', confidentiality: 'standard' },
  ],

  // § 4 — process templates with stages
  procedureTemplates: [
    {
      code: 'charger_procurement',
      name: 'Zamówienie i dostawa ładowarki',
      stages: [
        stage('model_confirmation', 'Potwierdzenie modelu z klientem', 'customer'),
        stage('supplier_order', 'Zamówienie u dostawcy'),
        stage('delivery', 'Dostawa ładowarki', { party: 'supplier' }),
      ],
    },
    {
      code: 'customer_charger_check',
      name: 'Weryfikacja ładowarki klienta',
      stages: [
        stage('compatibility_check', 'Weryfikacja modelu i parametrów urządzenia', 'customer'),
        stage('device_availability', 'Urządzenie dostępne na miejscu montażu', 'customer'),
      ],
    },
    {
      code: 'electrical_installation',
      name: 'Instalacja zasilająca',
      stages: [
        stage('site_survey', 'Oględziny i pomiar trasy'),
        stage('installation_work', 'Wykonanie instalacji'),
        stage('protection_connection', 'Zabezpieczenia i podłączenie'),
      ],
    },
    {
      code: 'charger_installation',
      name: 'Montaż i uruchomienie',
      stages: [
        stage('scheduling', 'Umówienie terminu montażu', 'customer'),
        stage('mounting', 'Montaż ładowarki'),
        stage('commissioning', 'Konfiguracja i uruchomienie', null, ['commissioning_report']),
        stage('handover', 'Instruktaż i przekazanie klientowi'),
      ],
    },
    {
      code: 'dso_connection',
      name: 'Uzgodnienia z OSD',
      stages: [
        stage('power_of_attorney', 'Pełnomocnictwo od klienta', 'customer', ['power_of_attorney']),
        stage('dso_application', 'Wniosek do OSD (warunki przyłączenia / zmiana mocy)', null, ['dso_application']),
        stage('connection_conditions', 'Warunki przyłączenia i projekt umowy', { party: 'distribution_system_operator' }, [
          'connection_conditions',
        ]),
        stage('dso_agreement_signed', 'Umowa z OSD podpisana, opłata przyłączeniowa wniesiona', 'customer', ['dso_agreement']),
        stage('dso_works', 'Prace sieciowe po stronie OSD (jeśli wymagane, np. przebudowa przyłącza)', {
          party: 'distribution_system_operator',
        }),
        stage('readiness_declaration', 'Zgłoszenie gotowości instalacji do OSD', null, ['dso_readiness_declaration']),
        stage('meter_connection', 'Wymiana licznika lub zabezpieczenia i załączenie przez OSD', {
          party: 'distribution_system_operator',
        }),
      ],
    },
    {
      code: 'building_management_approval',
      name: 'Zgody administracji / wspólnoty',
      stages: [
        stage('building_docs_request', 'Wniosek o dokumentację budynku'),
        stage('building_docs_received', 'Dokumentacja budynku otrzymana', { party: 'building_administration' }, ['building_documentation']),
        stage('consent_request', 'Wniosek o zgodę na instalację (z projektem i opiniami)'),
        stage('consent_received', 'Zgoda administracji / uchwała wspólnoty', { party: 'housing_community' }, [
          'building_management_consent',
        ]),
      ],
    },
    {
      code: 'technical_assessment',
      name: 'Ekspertyza techniczna',
      stages: [
        stage('expert_order', 'Zlecenie ekspertyzy'),
        stage('site_inspection', 'Wizja lokalna rzeczoznawcy', { party: 'technical_expert' }),
        stage('assessment_received', 'Ekspertyza otrzymana', { party: 'technical_expert' }, ['technical_assessment']),
      ],
    },
    {
      code: 'fire_safety_opinion',
      name: 'Opinia ppoż',
      stages: [
        stage('expert_order', 'Zlecenie opinii rzeczoznawcy ppoż'),
        stage('opinion_received', 'Opinia ppoż otrzymana', { party: 'fire_safety_expert' }, ['fire_safety_opinion']),
      ],
    },
    {
      code: 'installation_design',
      name: 'Projekt instalacji',
      stages: [
        stage('design_order', 'Zlecenie projektu'),
        stage('design_received', 'Projekt otrzymany', { party: 'designer' }, ['installation_design']),
      ],
    },
    {
      code: 'measurements_acceptance',
      name: 'Pomiary i odbiór',
      stages: [
        stage('electrical_measurements', 'Pomiary elektryczne', null, ['measurement_report']),
        stage('acceptance', 'Odbiór z klientem', 'customer', ['acceptance_report']),
      ],
    },
  ],

  // § 2 — service catalogue
  serviceItems: [
    {
      code: 'charger_supply',
      name: 'Dostawa ładowarki (z oferty)',
      category: 'equipment',
      parameterSetCode: 'charger_spec',
      procedureTemplateCodes: ['charger_procurement'],
    },
    {
      code: 'customer_charger',
      name: 'Ładowarka klienta',
      category: 'equipment',
      parameterSetCode: 'charger_spec',
      procedureTemplateCodes: ['customer_charger_check'],
    },
    {
      code: 'charger_installation',
      name: 'Montaż i uruchomienie ładowarki',
      category: 'installation',
      parameterSetCode: 'charger_installation',
      procedureTemplateCodes: ['charger_installation'],
    },
    {
      code: 'supply_installation',
      name: 'Instalacja zasilająca (obwód dedykowany lub istniejący)',
      category: 'installation',
      parameterSetCode: 'supply_circuit',
      procedureTemplateCodes: ['electrical_installation'],
    },
    {
      code: 'connection_power_increase',
      name: 'Zwiększenie mocy przyłączeniowej',
      category: 'formal',
      parameterSetCode: 'connection_power',
      procedureTemplateCodes: ['dso_connection'],
    },
    {
      code: 'dso_agreement',
      name: 'Uzgodnienia z OSD',
      category: 'formal',
      parameterSetCode: 'dso_request',
      procedureTemplateCodes: ['dso_connection'],
    },
    {
      code: 'building_management_approval',
      name: 'Zgody administracji / wspólnoty',
      category: 'formal',
      parameterSetCode: null,
      procedureTemplateCodes: ['building_management_approval'],
    },
    {
      code: 'technical_assessment',
      name: 'Ekspertyza techniczna',
      category: 'engineering',
      parameterSetCode: null,
      procedureTemplateCodes: ['technical_assessment'],
    },
    {
      code: 'fire_safety_opinion',
      name: 'Opinia ppoż',
      category: 'engineering',
      parameterSetCode: null,
      procedureTemplateCodes: ['fire_safety_opinion'],
    },
    {
      code: 'installation_design',
      name: 'Projekt instalacji',
      category: 'engineering',
      parameterSetCode: null,
      procedureTemplateCodes: ['installation_design'],
    },
    {
      code: 'measurements_acceptance',
      name: 'Pomiary i odbiór',
      category: 'acceptance',
      parameterSetCode: null,
      procedureTemplateCodes: ['measurements_acceptance'],
    },
    {
      code: 'custom_service',
      name: 'Inna usługa (opis w zleceniu)',
      category: 'other',
      parameterSetCode: null,
      procedureTemplateCodes: [],
    },
  ],

  // § 5 — work order templates with items and payment plans (shares and terms are examples, assumption 5)
  workOrderTemplates: [
    {
      code: 'house_full_package',
      name: 'Dom — pełny pakiet',
      siteTypeHint: 'single_family_house',
      items: [
        item('connection_power_increase'),
        item('supply_installation', { dedicatedCircuit: true }),
        item('charger_supply'),
        item('charger_installation'),
        item('measurements_acceptance'),
      ],
      paymentMilestones: [
        milestone('advance', 'Zaliczka', 30, 'przy akceptacji zlecenia', 7),
        milestone('final', 'Płatność końcowa', 70, 'po odbiorze', 14),
      ],
    },
    {
      code: 'house_installation_only',
      name: 'Dom — sam montaż',
      siteTypeHint: 'single_family_house',
      items: [item('customer_charger'), item('charger_installation'), item('measurements_acceptance')],
      paymentMilestones: [milestone('final', 'Płatność za montaż', 100, 'po uruchomieniu', 7)],
    },
    {
      code: 'garage_full_process',
      name: 'Garaż — pełny proces',
      siteTypeHint: 'multi_family_garage',
      items: [...GARAGE_FORMALITIES, item('charger_supply'), item('charger_installation'), item('measurements_acceptance')],
      paymentMilestones: [
        milestone('advance', 'Zaliczka', 20, 'przy akceptacji zlecenia', 7),
        milestone('approvals', 'Po uzyskaniu zgód i uzgodnień', 30, 'po zgodzie administracji i warunkach OSD', 14),
        milestone('installation', 'Po wykonaniu instalacji', 30, 'po zakończeniu instalacji zasilającej', 14),
        milestone('final', 'Płatność końcowa', 20, 'po odbiorze', 14),
      ],
    },
    {
      code: 'garage_installation_only',
      name: 'Garaż — sama instalacja',
      siteTypeHint: 'multi_family_garage',
      items: [...GARAGE_FORMALITIES, item('measurements_acceptance')],
      paymentMilestones: [
        milestone('advance', 'Zaliczka', 30, 'przy akceptacji zlecenia', 7),
        milestone('approvals', 'Po uzyskaniu zgód i uzgodnień', 30, 'po zgodzie administracji i warunkach OSD', 14),
        milestone('final', 'Płatność końcowa', 40, 'po odbiorze instalacji', 14),
      ],
    },
    {
      code: 'garage_charger_installation',
      name: 'Garaż — montaż ładowarki',
      siteTypeHint: 'multi_family_garage',
      items: [item('charger_supply'), item('charger_installation')],
      paymentMilestones: [milestone('final', 'Płatność za urządzenie i montaż', 100, 'po uruchomieniu', 7)],
    },
  ],
};
