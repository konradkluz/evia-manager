import { describe, expect, it } from 'vitest';
import { assessMilestonesForDeletion } from '../../src/modules/payments/domain/deletion-assessment.ts';
import type { PaymentMilestoneStatus } from '../../src/modules/payments/domain/money.ts';

describe('what the milestones say about the deletion of the order (EVM-060 AC1-AC3; SR-AUTHZ-10, SR-ERR-01)', () => {
  it('EVM-060 AC1 no milestone, planned and cancelled ones: nothing blocks and nothing needs a step-up', () => {
    expect(assessMilestonesForDeletion([])).toEqual({ blocked: false, stepUpRequired: false });
    expect(assessMilestonesForDeletion(['planned', 'cancelled'])).toEqual({ blocked: false, stepUpRequired: false });
  });

  it('EVM-060 AC2 an invoiced milestone blocks, also next to a paid one', () => {
    expect(assessMilestonesForDeletion(['invoiced'])).toEqual({ blocked: true, stepUpRequired: false });
    expect(assessMilestonesForDeletion(['paid', 'invoiced', 'planned'])).toEqual({ blocked: true, stepUpRequired: true });
  });

  it('EVM-060 AC3 a paid milestone needs a step-up and blocks nothing', () => {
    expect(assessMilestonesForDeletion(['paid'])).toEqual({ blocked: false, stepUpRequired: true });
    expect(assessMilestonesForDeletion(['planned', 'paid', 'cancelled'])).toEqual({ blocked: false, stepUpRequired: true });
  });

  it('EVM-060 AC2 SR-ERR-01 a status the rule does not know blocks the deletion (fail closed)', () => {
    expect(assessMilestonesForDeletion(['refunded' as PaymentMilestoneStatus])).toEqual({ blocked: true, stepUpRequired: false });
  });
});
