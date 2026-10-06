import { zRegisterPasskeyRequest } from '@evia/contracts/zod';
import type { RegisterPasskeyRequest } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { claimedChallenge, toRegistrationResponse } from '../../src/modules/identity/domain/webauthn-input.ts';
import { CEREMONY_TIMEOUT_MS, SimpleWebAuthnPasskeys } from '../../src/modules/identity/infrastructure/simplewebauthn-passkeys.ts';
import { VirtualAuthenticator } from '../support/virtual-authenticator.ts';

const ORIGIN = 'https://panel.evia.test';
const RP_ID = 'panel.evia.test';
const passkeys = new SimpleWebAuthnPasskeys({ rpId: RP_ID, rpName: 'EVia Manager', origin: ORIGIN });
const userHandle = Buffer.alloc(32, 7);

const options = (excludeCredentialIds: string[] = []) =>
  passkeys.registrationOptions({ userHandle, email: 'jan.przykladowy@evia.invalid', displayName: 'Jan Przykładowy', excludeCredentialIds });

describe('registration options (EVM-016 AC4; SR-AUTH-09, ASVS V6.3.3, V11.6.1)', () => {
  it('EVM-016 AC4 the options ask for user verification, no attestation, the RP of the configuration and the user handle (not the e-mail)', async () => {
    const result = await options();
    expect(result.rp).toEqual({ id: RP_ID, name: 'EVia Manager' });
    expect(result.attestation).toBe('none');
    expect(result.authenticatorSelection).toMatchObject({ userVerification: 'required', residentKey: 'preferred' });
    expect(result.timeout).toBe(CEREMONY_TIMEOUT_MS);
    expect(result.user.name).toBe('jan.przykladowy@evia.invalid');
    expect(result.user.displayName).toBe('Jan Przykładowy');
    expect(Buffer.from(result.user.id, 'base64url').equals(userHandle)).toBe(true);
    expect(result.user.id).not.toContain('przykladowy');
    expect(result.pubKeyCredParams.map((param) => param.alg)).toEqual([-8, -7, -257]);
  });

  it('EVM-016 AC4 every challenge is fresh and has at least 128 bits (here 256)', async () => {
    const challenges = await Promise.all(Array.from({ length: 20 }, async () => (await options()).challenge));
    expect(new Set(challenges).size).toBe(20);
    for (const challenge of challenges) expect(Buffer.from(challenge, 'base64url').length).toBeGreaterThanOrEqual(16);
  });

  it('EVM-016 AC4 keys the account already has are excluded, so one authenticator cannot be registered twice', async () => {
    const result = await options(['credential-one', 'credential-two']);
    expect(result.excludeCredentials?.map((credential) => credential.id)).toEqual(['credential-one', 'credential-two']);
  });
});

describe('registration verification (EVM-016 AC4; SR-AUTH-09, ASVS V6.3.3)', () => {
  it('EVM-016 AC4 a correct response with user verification is accepted and the key material is returned', async () => {
    const authenticator = new VirtualAuthenticator();
    const issued = await options();
    const verified = await passkeys.verifyRegistration(authenticator.register(issued, { origin: ORIGIN }), issued.challenge);
    expect(verified).toMatchObject({
      credentialId: authenticator.credentialId.toString('base64url'),
      counter: 0,
      deviceType: 'single_device',
      backedUp: false,
    });
    expect(verified?.publicKey.length).toBeGreaterThan(30);
    expect(verified?.transports).toEqual(['internal']);
  });

  it.each([
    ['another origin (phishing site)', { origin: 'https://panel.evia.invalid' }],
    ['the origin of a subdomain', { origin: 'https://evil.panel.evia.test' }],
    ['the same host over http', { origin: 'http://panel.evia.test' }],
    ['another RP ID', { rpId: 'evia.invalid' }],
    ['the parent domain as RP ID', { rpId: 'evia.test' }],
    ['no user verification', { userVerified: false }],
    ['no user presence', { userPresent: false }],
    ['a different ceremony type', { type: 'webauthn.get' }],
    ['a different challenge than the one asked for', { challenge: Buffer.alloc(32, 1).toString('base64url') }],
  ])('EVM-016 AC4 a response with %s is refused', async (_label, knobs) => {
    const authenticator = new VirtualAuthenticator();
    const issued = await options();
    const response = authenticator.register(issued, { origin: ORIGIN, ...knobs });
    expect(await passkeys.verifyRegistration(response, issued.challenge)).toBeNull();
  });

  it('EVM-016 AC4 a response answering an earlier challenge is refused (replay of an old ceremony)', async () => {
    const authenticator = new VirtualAuthenticator();
    const old = await options();
    const current = await options();
    expect(await passkeys.verifyRegistration(authenticator.register(old, { origin: ORIGIN }), current.challenge)).toBeNull();
  });

  it('EVM-016 AC4 a damaged or foreign attestation is refused without an exception', async () => {
    const authenticator = new VirtualAuthenticator();
    const issued = await options();
    const response = authenticator.register(issued, { origin: ORIGIN });
    for (const attestationObject of [
      '',
      'AAAA',
      'o2Nmb3JtZG5vbmVnYXR0U3RtdKBoYXV0aERhdGFA',
      response.response.attestationObject.slice(0, 40),
    ]) {
      const damaged = { ...response, response: { ...response.response, attestationObject } };
      expect(await passkeys.verifyRegistration(damaged, issued.challenge), attestationObject).toBeNull();
    }
    expect(
      await passkeys.verifyRegistration({ ...response, response: { ...response.response, clientDataJSON: 'e30' } }, issued.challenge),
    ).toBeNull();
  });
});

describe('the challenge hint and the request mapping (EVM-016 AC4)', () => {
  const challenge = Buffer.alloc(32, 9).toString('base64url');
  const clientData = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  it('EVM-016 AC4 the challenge is read from clientDataJSON and only when it looks like a challenge', () => {
    expect(claimedChallenge(clientData({ type: 'webauthn.create', challenge, origin: ORIGIN }))).toBe(challenge);
    for (const hostile of [
      clientData({ challenge: 5 }),
      clientData({ challenge: '' }),
      clientData({ challenge: 'short' }),
      clientData({ challenge: `${challenge}!` }),
      clientData({ challenge: 'a'.repeat(129) }),
      clientData({}),
      clientData(null),
      clientData('text'),
      Buffer.from('not json', 'utf8').toString('base64url'),
      '%%%',
      '',
    ]) {
      expect(claimedChallenge(hostile), hostile.slice(0, 20)).toBeUndefined();
    }
  });

  it('EVM-016 AC4 the body of the contract becomes the library response, with optional parts only when sent', () => {
    const minimal: RegisterPasskeyRequest = zRegisterPasskeyRequest.parse({
      credential: { id: 'abc', rawId: 'abc', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'e30' } },
    });
    expect(toRegistrationResponse(minimal)).toEqual({
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: 'e30', attestationObject: 'e30' },
    });
    const full: RegisterPasskeyRequest = zRegisterPasskeyRequest.parse({
      credential: {
        id: 'abc',
        rawId: 'abc',
        type: 'public-key',
        authenticatorAttachment: 'platform',
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: 'e30',
          attestationObject: 'e30',
          authenticatorData: 'AQ',
          publicKey: 'Ag',
          publicKeyAlgorithm: -7,
          transports: ['internal', 'hybrid'],
        },
      },
    });
    expect(toRegistrationResponse(full)).toEqual({
      id: 'abc',
      rawId: 'abc',
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: 'e30',
        attestationObject: 'e30',
        authenticatorData: 'AQ',
        publicKey: 'Ag',
        publicKeyAlgorithm: -7,
        transports: ['internal', 'hybrid'],
      },
    });
  });
});
