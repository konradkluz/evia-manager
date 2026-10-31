import { describe, expect, it } from 'vitest';
import { normalizeQuickSite } from '../../src/modules/sites/domain/quick-site.ts';
import { uuidv7 } from '../support/uuid.ts';

const site = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  siteType: 'single_family_house' as const,
  street: 'ul. Fikcyjna',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
  ...overrides,
});

describe('the new site of a quick work order (EVM-099 AC2)', () => {
  it('EVM-099 AC2 a site has only the fields of the command; the other fields stay empty', () => {
    const result = normalizeQuickSite(site({ apartmentNumber: '3' }));
    expect(result.ok && result.site).toMatchObject({
      street: 'ul. Fikcyjna',
      apartmentNumber: '3',
      parkingSpotNumber: null,
      garageLevel: null,
      connectionPowerKw: null,
      meteringPointId: null,
      distributionSystemOperatorPartyId: null,
      managerPartyId: null,
      notes: null,
    });
  });

  it('EVM-099 AC2 a parking spot belongs to a garage only', () => {
    expect(normalizeQuickSite(site({ siteType: 'multi_family_garage', parkingSpotNumber: 'A12' })).ok).toBe(true);
    expect(normalizeQuickSite(site({ parkingSpotNumber: 'A12' }))).toEqual({
      ok: false,
      errors: [{ pointer: '/newSite/parkingSpotNumber', code: 'not_allowed_for_site_type' }],
    });
  });

  it('EVM-099 AC5 a bad postal code is a pointer and a code, never the value', () => {
    const result = normalizeQuickSite(site({ postalCode: '123456' }));
    expect(result).toEqual({ ok: false, errors: [{ pointer: '/newSite/postalCode', code: 'invalid_format' }] });
    expect(JSON.stringify(result)).not.toContain('123456');
  });
});
