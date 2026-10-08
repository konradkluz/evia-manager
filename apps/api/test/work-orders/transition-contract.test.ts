import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { describe, expect, it } from 'vitest';
import { TRANSITION_TABLE } from '../../src/modules/work-orders/domain/work-order-transitions.ts';
import { TRANSITION_WORK_ORDER_SCOPE, transitionScope } from '../../src/modules/work-orders/application/transition-work-order.service.ts';

const operation = AUTHZ_MANIFEST['transitionWorkOrder'];

describe('the table of transitions against the policy of the operation (EVM-030 AC4, AC7; SR-AUTHZ-12, SR-SESS-08)', () => {
  it('EVM-030 AC7 the operation is for Administrator and Editor only: every role a row names is among them, and Tylko odczyt is not', () => {
    expect(operation?.authz.roles).toEqual(['administrator', 'editor']);
    for (const rule of TRANSITION_TABLE) {
      for (const role of rule.roles) expect(operation?.authz.roles, `${rule.from}>${rule.to}`).toContain(role);
    }
    expect(TRANSITION_TABLE.some((rule) => rule.roles.includes('read_only'))).toBe(false);
  });

  it('EVM-030 AC4 an operation that holds a row with a step-up is on the web channel ONLY: the lint of the contract cannot see a step-up that the use case enforces (the operation says stepUp false), so this test does (SR-AUTHZ-12)', () => {
    expect(TRANSITION_TABLE.some((rule) => rule.stepUp)).toBe(true);
    expect(operation?.authz.stepUp).toBe(false);
    expect(operation?.authz.channels).toEqual(['web']);
  });

  it('EVM-030 AC4 the operation names the table of transitions (the field the guidelines give to the operations of state changes) and is audited', () => {
    expect(operation?.authz.transitions).toBe('workOrderStatus');
    expect(operation?.authz.audit).toBe(true);
    // a row that is audited needs the operation to be audited
    expect(TRANSITION_TABLE.some((rule) => rule.audit !== undefined)).toBe(true);
  });

  it('EVM-030 AC5 an idempotency key is bound to the route AND to the order: the same body on another order has another scope (CWE-841)', () => {
    const first = '0198b0a0-0000-7000-8000-000000000001';
    const second = '0198b0a0-0000-7000-8000-000000000002';
    expect(transitionScope(first)).toBe(`POST /api/v1/work-orders/${first}/transitions`);
    expect(transitionScope(first)).not.toBe(transitionScope(second));
    expect(TRANSITION_WORK_ORDER_SCOPE).toBe('POST /api/v1/work-orders/{workOrderId}/transitions');
    expect(transitionScope(first).length).toBeLessThanOrEqual(200); // the column of the record
  });
});
