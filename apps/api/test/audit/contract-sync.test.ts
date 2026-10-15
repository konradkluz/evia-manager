import { AUTHZ_MANIFEST } from '@evia/contracts/authz';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  zAuditAction,
  zAuditEventList,
  zAuditObjectType,
  zAuditOutcome,
  zAuditReasonCode,
  zListAuditEventsQuery,
} from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { auditQuerySchema } from '../../src/modules/audit/domain/audit-query.ts';
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, AUDIT_OUTCOMES } from '../../src/modules/audit/domain/audit-record.ts';
import { MAX_CURSOR_LENGTH } from '../../src/platform/crypto/opaque-cursor.ts';
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

describe('the cursor of the audit log in the contract (EVM-080 AC1, AC2)', () => {
  const token = (length: number): string => 'A'.repeat(length);

  it('EVM-080 AC1 the contract admits a cursor and a nextCursor as long as the codec issues (512), no longer', () => {
    expect(zListAuditEventsQuery.safeParse({ cursor: token(MAX_CURSOR_LENGTH) }).success).toBe(true);
    expect(zListAuditEventsQuery.safeParse({ cursor: token(MAX_CURSOR_LENGTH + 1) }).success).toBe(false);
    expect(zAuditEventList.safeParse({ items: [], nextCursor: token(MAX_CURSOR_LENGTH) }).success).toBe(true);
    expect(zAuditEventList.safeParse({ items: [], nextCursor: token(MAX_CURSOR_LENGTH + 1) }).success).toBe(false);
  });

  it('EVM-080 AC2 a refused query or cursor is documented as the shared InvalidListQuery response (validation_failed and invalid_cursor)', () => {
    const file = join(import.meta.dirname, '../../../../packages/contracts/openapi/paths/audit.yaml');
    const source = readFileSync(file, 'utf8').replaceAll(/\r/g, '');
    expect(source).toContain("'400':\n        $ref: ../components/responses.yaml#/InvalidListQuery");
    expect(source).toContain('invalid_cursor');
  });
});
