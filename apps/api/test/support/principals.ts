import { ANONYMOUS, type Authentication, type Principal } from '../../src/platform/http/principal.ts';

/** A synthetic principal for guard tests (no real data). */
export function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: '0190a1b2-0000-7000-8000-00000000a001',
    role: 'administrator',
    channel: 'web',
    sessionId: '0190a1b2-0000-7000-8000-00000000b001',
    state: 'active',
    csrfToken: 'synthetic-csrf-token',
    passkeyAuthenticatedAt: null,
    lastSeenAt: new Date('2026-10-05T06:00:00Z'),
    idleExpiresAt: new Date('2026-10-05T07:00:00Z'),
    absoluteExpiresAt: new Date('2026-10-05T18:00:00Z'),
    ...overrides,
  };
}

/** A session resolver for tests that always answers with the given authentication. */
export const resolverOf = (authentication: Authentication | (() => Promise<Authentication>)) => ({
  resolve: typeof authentication === 'function' ? authentication : () => Promise.resolve(authentication),
});

export const anonymousResolver = resolverOf(ANONYMOUS);
