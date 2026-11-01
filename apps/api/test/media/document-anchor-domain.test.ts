import { describe, expect, it } from 'vitest';
import { anchorOf, checkAnchor, mayRaiseOnAnchor } from '../../src/modules/media/domain/document-anchor.ts';

const ok = { hasSite: true, hasCustomer: true, hasStage: false, documentClass: 'standard' } as const;

describe('document anchor (EVM-050)', () => {
  it('EVM-050 AC1 a document of the order, the site and the customer is accepted without a stage', () => {
    for (const anchor of ['work_order', 'site', 'customer'] as const) expect(checkAnchor({ ...ok, anchor })).toEqual([]);
    expect(checkAnchor({ ...ok, anchor: 'site', documentClass: 'building_security' })).toEqual([]);
  });

  it('EVM-050 AC1 a stage belongs to the anchor of the order only', () => {
    expect(checkAnchor({ ...ok, anchor: 'work_order', hasStage: true })).toEqual([]);
    for (const anchor of ['site', 'customer'] as const) {
      expect(checkAnchor({ ...ok, anchor, hasStage: true })).toEqual([
        { pointer: '/procedureStageId', code: 'requires_work_order_anchor' },
      ]);
    }
  });

  it('EVM-050 AC1 the customer anchor needs a customer and the site anchor needs a site', () => {
    expect(checkAnchor({ ...ok, anchor: 'customer', hasCustomer: false })).toEqual([{ pointer: '/anchor', code: 'no_customer' }]);
    expect(checkAnchor({ ...ok, anchor: 'site', hasSite: false })).toEqual([{ pointer: '/anchor', code: 'no_site' }]);
    expect(checkAnchor({ ...ok, anchor: 'work_order', hasSite: false, hasCustomer: false })).toEqual([]);
  });

  it('EVM-050 AC5 identity data never sits on a site (SR-AUTHZ-08, AB-19) but may sit on a customer', () => {
    expect(checkAnchor({ ...ok, anchor: 'site', documentClass: 'identity_data' })).toEqual([
      { pointer: '/anchor', code: 'identity_data_not_on_site' },
    ]);
    expect(checkAnchor({ ...ok, anchor: 'customer', documentClass: 'identity_data' })).toEqual([]);
    expect(checkAnchor({ ...ok, anchor: 'work_order', documentClass: 'identity_data' })).toEqual([]);
  });

  it('EVM-050 AC5 a class cannot be raised to identity data on a site document', () => {
    expect(mayRaiseOnAnchor('site', 'identity_data')).toBe(false);
    expect(mayRaiseOnAnchor('site', 'building_security')).toBe(true);
    expect(mayRaiseOnAnchor('customer', 'identity_data')).toBe(true);
    expect(mayRaiseOnAnchor('work_order', 'identity_data')).toBe(true);
  });

  it('EVM-050 AC1 the anchor is read from the columns', () => {
    expect(anchorOf({ work_order_id: 'a', site_id: null, customer_id: null })).toBe('work_order');
    expect(anchorOf({ work_order_id: null, site_id: 's', customer_id: null })).toBe('site');
    expect(anchorOf({ work_order_id: null, site_id: null, customer_id: 'c' })).toBe('customer');
  });
});
