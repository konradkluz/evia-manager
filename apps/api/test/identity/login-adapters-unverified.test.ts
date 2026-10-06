import { describe, expect, it, vi } from 'vitest';

// The library throws for an invalid assertion and answers `verified: true` otherwise; the adapter still refuses a
// "verified: false" answer, should a later version ever return one (fail closed).
vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyAuthenticationResponse: vi.fn(() => Promise.resolve({ verified: false, authenticationInfo: { newCounter: 9 } })),
}));

const { SimpleWebAuthnPasskeys } = await import('../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts');

describe('assertion verification fails closed (EVM-067 AC4; SR-AUTH-09)', () => {
  it('EVM-067 AC4 an answer that is not "verified" gives no counter, whatever else it carries', async () => {
    const passkeys = new SimpleWebAuthnPasskeys({ rpId: 'panel.evia.test', rpName: 'EVia Manager', origin: 'https://panel.evia.test' });
    const response = {
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag' },
    } as const;
    const key = { credentialId: 'abc', publicKey: Buffer.alloc(40), counter: 0, transports: [] };
    expect(await passkeys.verifyAuthentication(response, 'Q'.repeat(43), key)).toBeNull();
  });
});
