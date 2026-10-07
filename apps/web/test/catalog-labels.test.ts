// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  confidentialityLabels,
  partyKindLabels,
  serviceCategoryLabels,
  siteTypeLabels,
  waitingOnLabels,
} from '../src/i18n/catalog-labels.ts';

describe('Polish labels of the catalogue vocabularies (EVM-019 AC4; service-catalog.md § 7)', () => {
  it('EVM-019 AC4 the labels of SiteType and PartyKind are the ones accepted in § 7, keyed by the snake_case values of the API', () => {
    expect(siteTypeLabels).toEqual({
      single_family_house: 'Dom jednorodzinny',
      multi_family_garage: 'Garaż w budynku wielorodzinnym',
      commercial: 'Obiekt komercyjny',
      other: 'Inny',
    });
    expect(Object.keys(partyKindLabels)).toEqual([
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
    ]);
    expect(partyKindLabels.distribution_system_operator).toBe('OSD');
    expect(partyKindLabels.housing_community).toBe('Wspólnota / spółdzielnia');
  });

  it('EVM-019 AC4 every value has a non-empty Polish label: categories (§ 1), document confidentiality (§ 6) and the waiting party', () => {
    for (const labels of [siteTypeLabels, partyKindLabels, serviceCategoryLabels, confidentialityLabels, waitingOnLabels]) {
      for (const [value, label] of Object.entries(labels)) {
        expect(label.trim().length, value).toBeGreaterThan(0);
        expect(value, value).toMatch(/^[a-z][a-z_]*$/);
      }
    }
    expect(serviceCategoryLabels.formal).toBe('Formalności i uzgodnienia');
    expect(confidentialityLabels.identity_data).toBe('Dane identyfikacyjne osób');
  });
});
