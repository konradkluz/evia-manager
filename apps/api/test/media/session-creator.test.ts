import { describe, expect, it } from 'vitest';
import { creatorOf } from '../../src/modules/media/application/media-support.ts';
import { ProblemException } from '../../src/platform/http/problem.ts';
import type { Principal } from '../../src/platform/http/principal.ts';

const base = {
  userId: '0193a000-0000-7000-8000-000000000001',
  role: 'editor',
  sessionId: 's',
  state: 'active',
  csrfToken: 't',
  passkeyAuthenticatedAt: null,
  totpAuthenticatedAt: null,
  lastSeenAt: new Date(0),
  idleExpiresAt: new Date(0),
  absoluteExpiresAt: new Date(0),
} as const;
const DEVICE = '0193a000-0000-7000-8000-0000000000d1';

describe('the creator of an upload session (EVM-131 AC1; SR-SYNC-08, SR-API-05, CWE-639)', () => {
  it('EVM-131 AC1 the panel has no device; the phone has the device of its SESSION', () => {
    expect(creatorOf({ ...base, channel: 'web' } satisfies Principal)).toEqual({ userId: base.userId, deviceId: null });
    expect(creatorOf({ ...base, channel: 'mobile', deviceId: DEVICE } satisfies Principal)).toEqual({
      userId: base.userId,
      deviceId: DEVICE,
    });
  });

  it('EVM-131 AC1 a device on a session of the panel is ignored (the panel is never the creator of a phone), and a phone without a device fails closed with 403', () => {
    expect(creatorOf({ ...base, channel: 'web', deviceId: DEVICE } satisfies Principal).deviceId).toBeNull();
    expect(() => creatorOf({ ...base, channel: 'mobile' } satisfies Principal)).toThrow(ProblemException);
    try {
      creatorOf({ ...base, channel: 'mobile' } satisfies Principal);
    } catch (error) {
      expect((error as ProblemException).code).toBe('forbidden');
    }
  });
});
