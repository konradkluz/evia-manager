import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zCreatePartyHeaders,
  zCreateSiteHeaders,
  zParty,
  zPartySearchRequest,
  zPartySearchResult,
  zPartyWritable,
  zSite,
  zSiteSearchResult,
  zSiteWritable,
} from '../src/zod.ts';

const V7 = '0198b0a0-0000-7000-8000-000000000001';
const site = {
  id: V7,
  siteType: 'single_family_house',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
};
const party = { id: V7, kind: 'distribution_system_operator', legalForm: 'organization', displayName: 'Operator Testowy' };

describe('sites and parties contract (EVM-021 AC1-AC6; SR-API-04, SR-INPUT-01, SR-INPUT-02, SR-AUTHZ-01, SR-AUTHZ-04)', () => {
  it('EVM-021 AC6 the searches are POSTs for the three roles, the creations POSTs for Administrator and Editor with audit — all on the web channel only', () => {
    for (const [operation, path] of [
      ['searchSites', '/api/v1/sites/search'],
      ['searchParties', '/api/v1/parties/search'],
    ] as const)
      expect(AUTHZ_MANIFEST[operation], operation).toMatchObject({
        method: 'post',
        path,
        authz: { roles: ['administrator', 'editor', 'read_only'], channels: ['web'], audit: false },
      });
    for (const [operation, path] of [
      ['createSite', '/api/v1/sites'],
      ['createParty', '/api/v1/parties'],
    ] as const)
      expect(AUTHZ_MANIFEST[operation], operation).toMatchObject({
        method: 'post',
        path,
        authz: { roles: ['administrator', 'editor'], channels: ['web'], audit: true },
      });
  });

  it('EVM-021 AC1 the search phrase is not a parameter of the URL: no operation declares a query parameter', () => {
    for (const operation of ['searchSites', 'searchParties', 'createSite', 'createParty'])
      expect(AUTHZ_MANIFEST[operation]?.query, operation).toEqual([]);
  });

  it('EVM-021 AC5 the fields of the server are readOnly: they are in the resource and not in the input (the list the validation uses)', () => {
    const serverFields = ['createdAt', 'createdBy', 'deletedAt', 'deletedBy', 'searchText', 'updatedAt', 'updatedBy', 'version'];
    for (const [full, writable] of [
      [zSite, zSiteWritable],
      [zParty, zPartyWritable],
    ] as const)
      expect(
        Object.keys(full.shape)
          .filter((key) => !(key in writable.shape))
          .sort(),
      ).toEqual(serverFields);
  });

  it('EVM-021 AC2 the site has no customer: customerId is not a field of the input', () => {
    expect('customerId' in zSiteWritable.shape).toBe(false);
  });

  it('EVM-021 AC2 the id and the Idempotency-Key are UUIDv7 (another version is refused at the boundary)', () => {
    expect(zSiteWritable.safeParse(site).success).toBe(true);
    expect(zSiteWritable.safeParse({ ...site, id: '0198b0a0-0000-4000-8000-000000000001' }).success).toBe(false);
    expect(zPartyWritable.safeParse(party).success).toBe(true);
    expect(zPartyWritable.safeParse({ ...party, id: 'not-a-uuid' }).success).toBe(false);
    for (const headers of [zCreateSiteHeaders, zCreatePartyHeaders]) {
      expect(headers.safeParse({ 'Idempotency-Key': V7 }).success).toBe(true);
      expect(headers.safeParse({}).success).toBe(true);
      expect(headers.safeParse({ 'Idempotency-Key': '0198b0a0-0000-4000-8000-000000000001' }).success).toBe(false);
    }
  });

  it('EVM-021 AC2 the postal code is NN-NNN, the power is in (0, 1000] kW, the PPE at most 40 characters, the notes at most 2000', () => {
    expect(zSiteWritable.safeParse({ ...site, postalCode: '00001' }).success).toBe(false);
    expect(zSiteWritable.safeParse({ ...site, postalCode: '00-0011' }).success).toBe(false);
    expect(zSiteWritable.safeParse({ ...site, connectionPowerKw: 11 }).success).toBe(true);
    for (const connectionPowerKw of [0, -1, 1000.01, '11'])
      expect(zSiteWritable.safeParse({ ...site, connectionPowerKw }).success, String(connectionPowerKw)).toBe(false);
    expect(zSiteWritable.safeParse({ ...site, connectionPowerKw: 1000 }).success).toBe(true);
    expect(zSiteWritable.safeParse({ ...site, meteringPointId: 'P'.repeat(40) }).success).toBe(true);
    expect(zSiteWritable.safeParse({ ...site, meteringPointId: 'P'.repeat(41) }).success).toBe(false);
    expect(zSiteWritable.safeParse({ ...site, notes: 'n'.repeat(2001) }).success).toBe(false);
  });

  it('EVM-021 AC5 every text is bounded: a street over 200 characters and a party name over 200 are refused', () => {
    expect(zSiteWritable.safeParse({ ...site, street: 'a'.repeat(201) }).success).toBe(false);
    expect(zSiteWritable.safeParse({ ...site, siteType: 'garage' }).success).toBe(false);
    expect(zPartyWritable.safeParse({ ...party, displayName: 'a'.repeat(201) }).success).toBe(false);
    expect(zPartyWritable.safeParse({ ...party, kind: 'osd' }).success).toBe(false);
    expect(zPartyWritable.safeParse({ ...party, legalForm: 'person' }).success).toBe(false);
  });

  it('EVM-021 AC3 the filter of the party search is a list of at most 10 kinds of the dictionary', () => {
    expect(zPartySearchRequest.safeParse({ query: 'stoen' }).success).toBe(true);
    expect(zPartySearchRequest.safeParse({ query: 'stoen', kinds: ['distribution_system_operator'] }).success).toBe(true);
    expect(zPartySearchRequest.safeParse({ query: 'stoen', kinds: [] }).success).toBe(false);
    expect(zPartySearchRequest.safeParse({ query: 'stoen', kinds: ['osd'] }).success).toBe(false);
    expect(zPartySearchRequest.safeParse({ query: 'stoen', kinds: Array.from({ length: 11 }, () => 'other') }).success).toBe(false);
  });

  it('EVM-021 AC1 the search results are list envelopes with a null cursor and at most 20 items', () => {
    for (const result of [zSiteSearchResult, zPartySearchResult]) {
      expect(result.safeParse({ items: [], nextCursor: null }).success).toBe(true);
      expect(result.safeParse([]).success).toBe(false);
    }
    const siteItem = { id: V7, siteType: 'other', street: 'ul. Testowa', buildingNumber: '7', postalCode: '00-001', city: 'Warszawa' };
    expect(zSiteSearchResult.safeParse({ items: Array.from({ length: 21 }, () => siteItem), nextCursor: null }).success).toBe(false);
    const partyItem = { id: V7, kind: 'other', legalForm: 'organization', displayName: 'Strona' };
    expect(zPartySearchResult.safeParse({ items: Array.from({ length: 21 }, () => partyItem), nextCursor: null }).success).toBe(false);
  });
});
