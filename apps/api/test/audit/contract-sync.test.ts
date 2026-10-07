import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { zAuditAction, zAuditObjectType, zAuditOutcome, zAuditReasonCode } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { auditQuerySchema } from '../../src/modules/audit/domain/audit-query.ts';
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, AUDIT_OUTCOMES } from '../../src/modules/audit/domain/audit-record.ts';
import { REASON_CODES } from '../../src/modules/identity/index.ts';

// The lists of the contract (what the panel and the clients see) and the lists of the code (what the trail accepts) are
// written twice, so a test keeps them equal: a new event type that the contract does not know would be a response the
// schema of the contract refuses, a value of the contract that the code does not know a filter that never matches.
describe('the audit lists of the contract equal those of the code (EVM-029 AC5; SR-DATA-03)', () => {
  it('EVM-029 AC5 actions, outcomes, object types and reason codes', () => {
    expect([...zAuditAction.options]).toEqual([...AUDIT_ACTIONS]);
    expect([...zAuditOutcome.options]).toEqual([...AUDIT_OUTCOMES]);
    expect([...zAuditObjectType.options]).toEqual([...AUDIT_OBJECT_TYPES]);
    expect([...zAuditReasonCode.options]).toEqual([...REASON_CODES]);
  });

  it('EVM-029 AC5 the query parameters of the contract are the keys of the query schema (an undeclared one is 400 unknown_parameter, a declared one is validated)', () => {
    const declared = AUTHZ_MANIFEST['listAuditEvents']?.query ?? [];
    expect([...declared].sort()).toEqual(Object.keys(auditQuerySchema.shape).sort());
  });

  it('EVM-029 AC5 reading the log is the only operation of the audit module and needs a step-up on the web channel for the Administrator', () => {
    expect(AUTHZ_MANIFEST['listAuditEvents']).toMatchObject({
      method: 'get',
      path: '/api/v1/audit/events',
      authz: { roles: ['administrator'], channels: ['web'], stepUp: true, audit: true },
    });
  });
});
