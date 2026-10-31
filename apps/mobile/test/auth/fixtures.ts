// Synthetic fixtures of the sign-in (EVM-100): shapes of the contract EVM-090, values that are obviously test values (gitleaks: no
// string that looks like a JWT or an API key — tokens are padded words, never random characters).
export const USER_A = '90000000-0000-4000-8000-0000000000aa';
export const USER_B = '90000000-0000-4000-8000-0000000000bb';
export const DEVICE_1 = '7a000000-0000-4000-8000-000000000001';
export const DEVICE_2 = '7a000000-0000-4000-8000-000000000002';
export const T0 = Date.parse('2026-10-30T08:00:00.000Z');

export const token = (name: string): string => `test-${name}`.padEnd(40, '-');
export const secret = (n: number): string => `secret${String(n)}`.padEnd(43, 'x');
export const challengeToken = (n: number): string => `challenge${String(n)}`.padEnd(43, 'c');

export function sessionBody(
  overrides: { n?: number; user?: string; deviceId?: string; serverTime?: number; withSecret?: boolean; role?: string } = {},
) {
  const n = overrides.n ?? 1;
  const serverTime = overrides.serverTime ?? T0;
  return {
    deviceId: overrides.deviceId ?? DEVICE_1,
    ...(overrides.withSecret === false ? {} : { installationSecret: secret(n) }),
    accessToken: token(`access-${String(n)}`),
    accessTokenExpiresAt: new Date(serverTime + 15 * 60_000).toISOString(),
    refreshToken: token(`refresh-${String(n)}`),
    refreshTokenExpiresAt: new Date(serverTime + 14 * 86_400_000).toISOString(),
    serverTime: new Date(serverTime).toISOString(),
    user: { id: overrides.user ?? USER_A, displayName: 'Piotr Testowy', role: overrides.role ?? 'editor' },
  };
}

export function problemBody(status: number, code: string) {
  return { type: 'about:blank', title: 'Synthetic', status, code, traceId: '0'.repeat(32) };
}
