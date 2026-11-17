import { describe, expect, it } from 'vitest';
import { decideAssignment, type AssignableOrder } from '../../src/modules/work-orders/domain/customer-assignment.ts';

const CUSTOMER = '0198b0a0-0000-4000-8000-000000000001';
const OTHER = '0198b0a0-0000-4000-8000-000000000002';
const DEADLINE = new Date('2027-02-14T08:00:00.000Z');
const survey = (over: Partial<AssignableOrder> = {}): AssignableOrder => ({
  customerId: null,
  siteSurveyExpiresAt: DEADLINE,
  status: 'quoting',
  version: 3,
  ...over,
});

describe('the decision of the assignment of a customer to a site survey (EVM-136 AC1, AC2; ADR-0024 pt 3)', () => {
  it('EVM-136 AC1 an open survey with the current version is assigned', () => {
    expect(decideAssignment({ customerId: CUSTOMER, version: 3 }, survey())).toEqual({ kind: 'assign' });
    expect(decideAssignment({ customerId: CUSTOMER, version: 3 }, survey({ status: 'on_hold' }))).toEqual({ kind: 'assign' });
  });

  it('EVM-136 AC2 the same customer is a no-op even with a stale version (a retry after the success has the old version)', () => {
    const assigned = survey({ customerId: CUSTOMER, siteSurveyExpiresAt: null, status: 'accepted', version: 4 });
    expect(decideAssignment({ customerId: CUSTOMER, version: 3 }, assigned)).toEqual({ kind: 'noop' });
  });

  it('EVM-136 AC2 another customer, or an ordinary order with a customer, is customer_already_set', () => {
    const assigned = survey({ customerId: CUSTOMER, siteSurveyExpiresAt: null, status: 'in_progress', version: 4 });
    expect(decideAssignment({ customerId: OTHER, version: 4 }, assigned)).toEqual({ kind: 'refuse', code: 'customer_already_set' });
  });

  it('EVM-136 AC2 a cancelled survey is refused with invalid_state_transition: the restoration of the Administrator comes first', () => {
    expect(decideAssignment({ customerId: CUSTOMER, version: 3 }, survey({ status: 'cancelled' }))).toEqual({
      kind: 'refuse',
      code: 'invalid_state_transition',
    });
  });

  it('EVM-136 AC2 a stale version is version_conflict, after the questions of the customer and of the state', () => {
    expect(decideAssignment({ customerId: CUSTOMER, version: 2 }, survey())).toEqual({ kind: 'refuse', code: 'version_conflict' });
    expect(decideAssignment({ customerId: CUSTOMER, version: 2 }, survey({ status: 'cancelled' }))).toEqual({
      kind: 'refuse',
      code: 'invalid_state_transition',
    });
  });
});
