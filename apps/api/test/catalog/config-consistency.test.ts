import { describe, expect, it } from 'vitest';
import { CATALOG_SEED_2026_10, type CatalogSeed } from '../../src/migrations/data/catalog-seed-2026-10.ts';
import {
  CatalogConfigError,
  assertCatalogConfigConsistent,
  validateCatalogConfig,
  type CatalogConfig,
} from '../../src/modules/catalog/domain/config-consistency.ts';
import { isConfigCode } from '../../src/modules/catalog/domain/vocabularies.ts';

const seed: CatalogConfig = CATALOG_SEED_2026_10;

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;
type Mutable = DeepMutable<CatalogSeed>;

/** The starting data with one change, to see which finding it causes. */
const changed = (change: (copy: Mutable) => void): CatalogConfig => {
  const copy: Mutable = structuredClone(CATALOG_SEED_2026_10);
  change(copy);
  return copy;
};

/** An element that must exist (a test of a missing fixture fails loudly instead of with a TypeError). */
function the<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the fixture element does not exist');
  return value;
}
const template = (copy: Mutable, code: string) => the(copy.workOrderTemplates.find((entry) => entry.code === code));
const procedure = (copy: Mutable, code: string) => the(copy.procedureTemplates.find((entry) => entry.code === code));
const serviceItem = (copy: Mutable, code: string) => the(copy.serviceItems.find((entry) => entry.code === code));
const at = <T>(list: readonly T[], index: number): T => the(list[index]);

describe('configuration consistency (EVM-019 AC3; SR-INPUT-02)', () => {
  it('EVM-019 AC3 the starting data is consistent: no finding, and the assertion of the gate does not throw', () => {
    expect(validateCatalogConfig(seed)).toEqual([]);
    expect(() => {
      assertCatalogConfigConsistent(seed);
    }).not.toThrow();
  });

  it('EVM-019 AC3 payment shares that do not sum to 100 fail with the code of the template', () => {
    const broken = changed((copy) => {
      at(template(copy, 'garage_full_process').paymentMilestones, 0).sharePercent = 10;
    });
    expect(validateCatalogConfig(broken)).toEqual([
      { elementCode: 'garage_full_process', rule: 'payment_shares_sum', detail: 'the shares of the payment plan sum to 90, not 100' },
    ]);
    expect(() => {
      assertCatalogConfigConsistent(broken);
    }).toThrow(CatalogConfigError);
    expect(() => {
      assertCatalogConfigConsistent(broken);
    }).toThrow(/^garage_full_process \[payment_shares_sum\]/);
  });

  it('EVM-019 AC3 a code outside ^[a-z][a-z0-9_]{1,63}$ fails with that code, for every kind of element', () => {
    for (const bad of ['Upper', '1digit', 'a', 'with-dash', 'with space', `a${'b'.repeat(64)}`, '_lead', ''])
      expect(isConfigCode(bad), bad).toBe(false);
    expect(isConfigCode('ab')).toBe(true);
    expect(isConfigCode(`a${'b'.repeat(63)}`)).toBe(true);
    const broken = changed((copy) => {
      at(copy.serviceItems, 0).code = 'Bad-Item';
      at(copy.documentKinds, 0).code = 'Bad Kind';
      at(procedure(copy, 'charger_procurement').stages, 0).code = '9stage';
      at(template(copy, 'house_full_package').paymentMilestones, 0).code = 'ADVANCE';
      template(copy, 'house_installation_only').code = 'house-only';
    });
    const findings = validateCatalogConfig(broken).filter((issue) => issue.rule === 'code_pattern');
    expect(findings.map((issue) => issue.elementCode).sort()).toEqual([
      'Bad Kind',
      'Bad-Item',
      'charger_procurement.9stage',
      'house-only',
      'house_full_package.ADVANCE',
    ]);
  });

  it('EVM-019 AC3 an unknown parameterSetCode fails with the code of the service item', () => {
    const broken = changed((copy) => {
      serviceItem(copy, 'charger_supply').parameterSetCode = 'charger_spec_v2';
    });
    expect(validateCatalogConfig(broken)).toContainEqual(
      expect.objectContaining({ elementCode: 'charger_supply', rule: 'unknown_parameter_set' }),
    );
  });

  it('EVM-019 AC3 a stage that points at a document kind that does not exist fails with the code of the stage', () => {
    const broken = changed((copy) => {
      at(procedure(copy, 'dso_connection').stages, 0).outputDocumentKindCodes = ['no_such_document'];
    });
    expect(validateCatalogConfig(broken)).toEqual([
      expect.objectContaining({ elementCode: 'dso_connection.power_of_attorney', rule: 'unknown_document_kind' }),
    ]);
  });

  it('EVM-019 AC3 default parameters that break the schema of their set, or have no set, fail with the template and item code', () => {
    const broken = changed((copy) => {
      const items = template(copy, 'house_full_package').items;
      the(items.find((item) => item.serviceItemCode === 'supply_installation')).defaultParameters = {
        dedicatedCircuit: true,
        ppe: 'PL0000000000000001',
      };
      the(items.find((item) => item.serviceItemCode === 'measurements_acceptance')).defaultParameters = { anything: 1 };
      the(items.find((item) => item.serviceItemCode === 'charger_installation')).defaultQuantity = 0;
    });
    expect(validateCatalogConfig(broken)).toEqual([
      { elementCode: 'house_full_package.supply_installation', rule: 'invalid_default_parameters', detail: 'ppe: unknown_field' },
      expect.objectContaining({ elementCode: 'house_full_package.charger_installation', rule: 'default_quantity' }),
      expect.objectContaining({ elementCode: 'house_full_package.measurements_acceptance', rule: 'parameters_without_set' }),
    ]);
  });

  it('EVM-019 AC3 references and vocabularies: unknown service item, process template, category, site type, confidentiality, party kind', () => {
    const broken = changed((copy) => {
      at(template(copy, 'house_full_package').items, 0).serviceItemCode = 'no_such_item';
      at(copy.serviceItems, 0).procedureTemplateCodes = ['no_such_process'];
      at(copy.serviceItems, 1).category = 'misc';
      template(copy, 'house_installation_only').siteTypeHint = 'castle';
      at(copy.documentKinds, 0).confidentiality = 'secret';
      at(procedure(copy, 'dso_connection').stages, 2).defaultWaitingOnPartyKind = 'aliens';
      at(procedure(copy, 'charger_procurement').stages, 0).defaultWaitingOn = 'moon';
    });
    expect(
      validateCatalogConfig(broken)
        .map((issue) => `${issue.elementCode} ${issue.rule}`)
        .sort(),
    ).toEqual(
      [
        'charger_procurement.model_confirmation default_waiting_on',
        'customer_charger category',
        'charger_supply unknown_procedure_template',
        'dso_connection.connection_conditions party_kind',
        'house_full_package.no_such_item unknown_service_item',
        'house_installation_only site_type_hint',
        'power_of_attorney confidentiality',
      ].sort(),
    );
  });

  it('EVM-019 AC3 structure: a party kind exactly when the stage waits for a party, a share range, a payment term, duplicates, empty process', () => {
    const broken = changed((copy) => {
      at(procedure(copy, 'charger_procurement').stages, 2).defaultWaitingOnPartyKind = null;
      at(procedure(copy, 'charger_procurement').stages, 0).defaultWaitingOnPartyKind = 'supplier';
      at(template(copy, 'house_installation_only').paymentMilestones, 0).sharePercent = 0;
      at(template(copy, 'garage_charger_installation').paymentMilestones, 0).paymentTermDays = 400;
      at(copy.serviceItems, 1).code = at(copy.serviceItems, 0).code;
      at(copy.documentKinds, 1).code = at(copy.documentKinds, 0).code;
      procedure(copy, 'installation_design').stages.length = 0;
      template(copy, 'garage_installation_only').items.push(at(template(copy, 'garage_installation_only').items, 0));
      template(copy, 'garage_full_process').paymentMilestones.push({ ...at(template(copy, 'garage_full_process').paymentMilestones, 0) });
      copy.procedureTemplates.push(at(copy.procedureTemplates, 0));
      copy.workOrderTemplates.push(at(copy.workOrderTemplates, 0));
      procedure(copy, 'electrical_installation').stages.push(at(procedure(copy, 'electrical_installation').stages, 0));
    });
    const rules = validateCatalogConfig(broken).map((issue) => `${issue.elementCode} ${issue.rule}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        'charger_procurement.delivery waiting_on_party_kind',
        'charger_procurement.model_confirmation waiting_on_party_kind',
        'house_installation_only.final share_percent_range',
        'house_installation_only payment_shares_sum',
        'garage_charger_installation.final payment_term_days',
        'charger_supply duplicate_code',
        'power_of_attorney duplicate_code',
        'installation_design no_stages',
        'building_management_approval duplicate_code',
        'advance duplicate_code',
        'charger_procurement duplicate_code',
        'house_full_package duplicate_code',
        'site_survey duplicate_code',
      ]),
    );
  });

  it('EVM-019 AC3 a list longer than the API returns at once is a finding', () => {
    const broken = changed((copy) => {
      for (let index = 0; index < 100; index += 1)
        copy.documentKinds.push({ code: `extra_kind_${index}`, name: 'Extra', confidentiality: 'standard' });
    });
    expect(validateCatalogConfig(broken)).toEqual([expect.objectContaining({ elementCode: 'document_kinds', rule: 'too_many_elements' })]);
  });
});

describe('starting data against the specification (EVM-019 AC1)', () => {
  it('EVM-019 AC1 the frozen data has the counts of service-catalog.md: 12 items, 10 processes with 32 stages, 16 document kinds, 5 templates', () => {
    expect(seed.serviceItems).toHaveLength(12);
    expect(seed.procedureTemplates).toHaveLength(10);
    expect(seed.procedureTemplates.flatMap((entry) => entry.stages)).toHaveLength(32);
    expect(seed.documentKinds).toHaveLength(16);
    expect(seed.workOrderTemplates.map((entry) => entry.code)).toEqual([
      'house_full_package',
      'house_installation_only',
      'garage_full_process',
      'garage_installation_only',
      'garage_charger_installation',
    ]);
    expect(seed.workOrderTemplates.map((entry) => [entry.items.length, entry.paymentMilestones.length])).toEqual([
      [5, 2],
      [3, 1],
      [9, 4],
      [7, 3],
      [2, 1],
    ]);
  });
});
