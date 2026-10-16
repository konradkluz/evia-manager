/**
 * The sealed secret of a TOTP factor (EVM-023 AC1; SR-CRYPTO-02): the envelope of `platform/crypto/field-encryption` with the account as authenticated
 * data, so a ciphertext copied from one row to another does not open. No key configured is `503 service_unavailable` (fail closed, nothing is ever
 * stored in the clear); a ciphertext that does not open is an error of the server, never a wrong code.
 */
import { FieldEncryptionUnavailableError, type FieldEncryption } from '../../../platform/crypto/field-encryption.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { totpSecretContext } from '../domain/totp.ts';

function unavailableAsProblem<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof FieldEncryptionUnavailableError) throw new ProblemException('service_unavailable');
    throw error;
  }
}

export const sealTotpSecret = (encryption: FieldEncryption, userId: string, secret: Buffer): Buffer =>
  unavailableAsProblem(() => encryption.encrypt(secret, totpSecretContext(userId)));

export const openTotpSecret = (encryption: FieldEncryption, userId: string, sealed: Buffer): Buffer =>
  unavailableAsProblem(() => encryption.decrypt(sealed, totpSecretContext(userId)));
