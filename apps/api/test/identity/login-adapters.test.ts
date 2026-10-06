import { zVerifyLoginPasskeyRequest } from '@evia/contracts/zod';
import { describe, expect, it } from 'vitest';
import { toAuthenticationResponse } from '../../src/modules/identity/domain/webauthn-input.ts';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.ts';
import { CEREMONY_TIMEOUT_MS, SimpleWebAuthnPasskeys } from '../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

const ORIGIN = 'https://panel.evia.test';
const RP_ID = 'panel.evia.test';
const passkeys = new SimpleWebAuthnPasskeys({ rpId: RP_ID, rpName: 'EVia Manager', origin: ORIGIN });

describe('Argon2id password verification (EVM-067 AC2; SR-AUTH-05, SR-AUTH-01, ASVS V6.3.1)', () => {
  it('EVM-067 AC2 verify accepts the right password and refuses a wrong one, without trimming or folding case', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('Zq9-lamp-Orbit-4');
    expect(await hasher.verify(hash, 'Zq9-lamp-Orbit-4')).toBe(true);
    for (const wrong of ['zq9-lamp-orbit-4', ' Zq9-lamp-Orbit-4', 'Zq9-lamp-Orbit-4 ', 'Zq9-lamp-Orbit-', '']) {
      expect(await hasher.verify(hash, wrong), JSON.stringify(wrong)).toBe(false);
    }
  });

  it('EVM-067 AC2 a malformed or foreign hash is a wrong password, never an exception that would tell the two apart', async () => {
    const hasher = new Argon2PasswordHasher();
    for (const hash of [
      '',
      'not a hash',
      '$argon2id$v=19$m=19456,t=2,p=1$short',
      '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    ]) {
      expect(await hasher.verify(hash, 'Zq9-lamp-Orbit-4'), hash).toBe(false);
    }
  });
});

describe('authentication options and assertion (EVM-067 AC4; SR-AUTH-09, ASVS V6.3.3, V11.6.1)', () => {
  /** A registered virtual key, as the database holds it. */
  async function registered() {
    const authenticator = new VirtualAuthenticator();
    const issued = await passkeys.registrationOptions({
      userHandle: Buffer.alloc(32, 7),
      email: 'jan.przykladowy@evia.invalid',
      displayName: 'Jan Przykładowy',
      excludeCredentialIds: [],
    });
    const verified = await passkeys.verifyRegistration(authenticator.register(issued, { origin: ORIGIN }), issued.challenge);
    if (verified === null) throw new Error('the registration of the fixture failed');
    return {
      authenticator,
      key: {
        credentialId: authenticator.credentialId.toString('base64url'),
        publicKey: verified.publicKey,
        counter: 0,
        transports: ['internal'],
      },
    };
  }

  it('EVM-067 AC4 the options require user verification, name the configured RP and list only the keys given, with a fresh 128+ bit challenge', async () => {
    const { key } = await registered();
    const first = await passkeys.authenticationOptions([key]);
    const second = await passkeys.authenticationOptions([key]);
    expect(first).toMatchObject({ rpId: RP_ID, userVerification: 'required', timeout: CEREMONY_TIMEOUT_MS });
    expect(first.allowCredentials).toEqual([{ id: key.credentialId, type: 'public-key', transports: ['internal'] }]);
    expect(first.challenge).not.toBe(second.challenge);
    expect(Buffer.from(first.challenge, 'base64url').length).toBeGreaterThanOrEqual(16);
  });

  it('EVM-067 AC4 a correct assertion with user verification gives the new counter', async () => {
    const { authenticator, key } = await registered();
    const issued = await passkeys.authenticationOptions([key]);
    expect(await passkeys.verifyAuthentication(authenticator.assert(issued), issued.challenge, key)).toEqual({ newCounter: 1 });
  });

  it('EVM-067 AC4 every deviation is refused with null and no exception: origin, RP ID, user verification and presence, ceremony type, challenge, signature, counter, foreign credential', async () => {
    const { authenticator, key } = await registered();
    const issued = await passkeys.authenticationOptions([key]);
    const other = new VirtualAuthenticator();
    const good = authenticator.assert(issued);
    const cases: Array<[string, ReturnType<typeof authenticator.assert>, string]> = [
      ['origin', authenticator.assert(issued, { origin: 'https://evil.invalid' }), issued.challenge],
      ['RP ID', authenticator.assert(issued, { rpId: 'evil.invalid' }), issued.challenge],
      ['no user verification', authenticator.assert(issued, { userVerified: false }), issued.challenge],
      ['no user presence', authenticator.assert(issued, { userPresent: false }), issued.challenge],
      ['ceremony type', authenticator.assert(issued, { type: 'webauthn.create' }), issued.challenge],
      ['another challenge', good, 'Q'.repeat(43)],
      ['a forged signature', authenticator.assert(issued, { signWith: other }), issued.challenge],
      ['a foreign credential id', { ...good, id: other.credentialId.toString('base64url') }, issued.challenge],
      ['a damaged signature', { ...good, response: { ...good.response, signature: 'AAAA' } }, issued.challenge],
    ];
    for (const [label, response, challenge] of cases) {
      expect(await passkeys.verifyAuthentication(response, challenge, key), label).toBeNull();
    }
  });

  it('EVM-067 AC4 an assertion is refused when the stored counter is already ahead (a cloned authenticator)', async () => {
    const { authenticator, key } = await registered();
    const issued = await passkeys.authenticationOptions([key]);
    expect(
      await passkeys.verifyAuthentication(authenticator.assert(issued, { counter: 5 }), issued.challenge, { ...key, counter: 5 }),
    ).toBeNull();
    expect(
      await passkeys.verifyAuthentication(authenticator.assert(issued, { counter: 6 }), issued.challenge, { ...key, counter: 5 }),
    ).toEqual({
      newCounter: 6,
    });
  });

  it('EVM-067 AC4 the body of the contract becomes the library assertion, with optional parts only when sent', () => {
    const minimal = zVerifyLoginPasskeyRequest.parse({
      loginToken: 'A'.repeat(43),
      credential: {
        id: 'abc',
        rawId: 'abc',
        type: 'public-key',
        response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag' },
      },
    });
    expect(toAuthenticationResponse(minimal.credential)).toEqual({
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag' },
    });
    const full = zVerifyLoginPasskeyRequest.parse({
      loginToken: 'A'.repeat(43),
      credential: {
        id: 'abc',
        rawId: 'abc',
        type: 'public-key',
        authenticatorAttachment: 'cross-platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag', userHandle: 'AwQ' },
      },
    });
    expect(toAuthenticationResponse(full.credential)).toEqual({
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      authenticatorAttachment: 'cross-platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: 'e30', authenticatorData: 'AQ', signature: 'Ag', userHandle: 'AwQ' },
    });
  });
});
