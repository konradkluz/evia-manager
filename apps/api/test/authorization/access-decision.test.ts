import type { AuthzManifest } from '@evia/contracts/authz';
import { describe, expect, it, vi } from 'vitest';
import { decideAccess } from '../../src/modules/authorization/access-decision.ts';

const manifest: AuthzManifest = {
  getHealth: { method: 'get', path: '/api/health', authz: { public: true } },
  getSecret: { method: 'get', path: '/api/v1/secret', authz: { public: true } },
  listWorkOrders: { method: 'get', path: '/api/v1/work-orders', authz: { roles: ['administrator'] } },
};
const decide = (operationId: string | undefined, principal: () => { userId: string } | null = () => null) =>
  decideAccess({ operationId, manifest, publicOperations: ['getHealth'], principal });

describe('access decision (EVM-008 AC4; SR-AUTHZ-01, SR-ERR-01)', () => {
  it('EVM-008 AC4 an operation without a policy in the manifest is forbidden (403)', () => {
    expect(decide(undefined)).toEqual({ allowed: false, code: 'forbidden' });
    expect(decide('notInTheContract')).toEqual({ allowed: false, code: 'forbidden' });
    expect(decide('constructor')).toEqual({ allowed: false, code: 'forbidden' });
    expect(decide('toString')).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('EVM-008 AC4 public is honoured only for allow-listed operations, without asking for a principal', () => {
    const principal = vi.fn(() => null);
    expect(decide('getHealth', principal)).toEqual({ allowed: true });
    expect(principal).not.toHaveBeenCalled();
    expect(decide('getSecret')).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('EVM-008 AC4 a protected operation without a principal is 401; with one it stays denied until E1 roles exist', () => {
    expect(decide('listWorkOrders')).toEqual({ allowed: false, code: 'unauthenticated' });
    expect(decide('listWorkOrders', () => ({ userId: 'synthetic-user' }))).toEqual({ allowed: false, code: 'forbidden' });
  });

  it('EVM-008 AC4 a failing principal lookup is never an allow (the error propagates to the error boundary)', () => {
    expect(() =>
      decide('listWorkOrders', () => {
        throw new Error('session store unavailable');
      }),
    ).toThrow('session store unavailable');
  });
});
