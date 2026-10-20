/**
 * The adapter of the TOTP arithmetic (`otpauth` 9.5.2, MIT; ADR-0005, SR-CRYPTO-01): no own implementation of HOTP/TOTP. `validate` of the library compares
 * every candidate code in constant time (a character-wise XOR over the whole code — checked in the source of 9.5.2, SR-CRYPTO-05); only the position of
 * a match (which of the three steps) can shorten the work, and that is not a secret.
 */
import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { TOTP_DIGITS, TOTP_ISSUER, TOTP_PERIOD_SECONDS, TOTP_SECRET_BYTES, TOTP_WINDOW } from '../domain/totp.ts';

export interface TotpEngine {
  /** A new secret of {@link TOTP_SECRET_BYTES} bytes from the CSPRNG. */
  newSecret(): Buffer;
  /** The secret as the authenticator apps take it ("show the key to type in"): base32, no padding. */
  base32(secret: Buffer): string;
  /** `otpauth://totp/…` for the QR code; the label is the e-mail of the employee, the issuer "EVia Manager". */
  uri(secret: Buffer, account: string): string;
  /** @returns the time step of the code when it is valid within the window of the given instant, otherwise null */
  match(secret: Buffer, code: string, now: Date): number | null;
}
export const TOTP_ENGINE = Symbol('TOTP_ENGINE');

const toSecret = (secret: Buffer): Secret => new Secret({ buffer: new Uint8Array(secret).buffer });

export class OtpauthTotpEngine implements TotpEngine {
  newSecret(): Buffer {
    return randomBytes(TOTP_SECRET_BYTES);
  }

  base32(secret: Buffer): string {
    return toSecret(secret).base32;
  }

  uri(secret: Buffer, account: string): string {
    return new TOTP({
      issuer: TOTP_ISSUER,
      label: account,
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: toSecret(secret),
    }).toString();
  }

  match(secret: Buffer, code: string, now: Date): number | null {
    const delta = TOTP.validate({
      token: code,
      secret: toSecret(secret),
      algorithm: 'SHA1',
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      timestamp: now.getTime(),
      window: TOTP_WINDOW,
    });
    return delta === null ? null : Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS) + delta;
  }
}
