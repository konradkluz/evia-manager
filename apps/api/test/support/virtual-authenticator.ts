/**
 * A software WebAuthn authenticator for tests (a roaming/platform key that always answers like a real one would for the
 * `none` attestation): ES256 key pair, authenticator data with the user presence and user verification flags, and the
 * `clientDataJSON` a browser would build. The tests tamper with the knobs (origin, RP ID, user verification) to check
 * that the server refuses the response. Synthetic keys only.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export interface RegistrationKnobs {
  readonly origin?: string;
  readonly rpId?: string;
  readonly userVerified?: boolean;
  readonly userPresent?: boolean;
  readonly challenge?: string;
  readonly type?: string;
}

const b64 = (data: Buffer | Uint8Array): string => Buffer.from(data).toString('base64url');

export class VirtualAuthenticator {
  readonly credentialId: Buffer = randomBytes(32);
  readonly #publicJwk: { x: string; y: string };

  constructor() {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    this.#publicJwk = { x: jwk.x ?? '', y: jwk.y ?? '' };
  }

  /** The `navigator.credentials.create()` result for the options, as `PublicKeyCredential.toJSON()` returns it. */
  register(options: PublicKeyCredentialCreationOptionsJSON, knobs: RegistrationKnobs = {}): RegistrationResponseJSON {
    const rpId = knobs.rpId ?? options.rp.id ?? '';
    const flags = (knobs.userPresent === false ? 0 : 0x01) | (knobs.userVerified === false ? 0 : 0x04) | 0x40;
    const coseKey = Buffer.from(
      isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(this.#publicJwk.x, 'base64url')],
          [-3, Buffer.from(this.#publicJwk.y, 'base64url')],
        ]),
      ),
    );
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authenticatorData = Buffer.concat([
      createHash('sha256').update(rpId, 'utf8').digest(),
      Buffer.from([flags]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      coseKey,
    ]);
    const attestationObject = Buffer.from(
      isoCBOR.encode(
        new Map<string, string | Map<string, never> | Uint8Array>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, never>()],
          ['authData', authenticatorData],
        ]),
      ),
    );
    const clientData = {
      type: knobs.type ?? 'webauthn.create',
      challenge: knobs.challenge ?? options.challenge,
      origin: knobs.origin ?? 'https://panel.evia.test',
      crossOrigin: false,
    };
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(Buffer.from(JSON.stringify(clientData), 'utf8')),
        attestationObject: b64(attestationObject),
        transports: ['internal'],
      },
    };
  }
}
