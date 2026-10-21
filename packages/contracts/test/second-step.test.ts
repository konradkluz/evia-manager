import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import {
  zConfirmTotpRequestWritable,
  zLoginRecoveryCodeRequestWritable,
  zLoginSecondStep,
  zLoginTotpRequestWritable,
  zRecoveryCodes,
  zStepUpRequestWritable,
  zTotpSetup,
} from '../src/zod.ts';

const TOKEN = 'A'.repeat(43);
const ASSERTION = {
  id: 'AQID',
  rawId: 'AQID',
  type: 'public-key',
  response: { clientDataJSON: 'AQID', authenticatorData: 'AQID', signature: 'AQID' },
};

interface Schema {
  properties?: Record<string, { readOnly?: boolean; writeOnly?: boolean; $ref?: string }>;
}
const bundle = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as { components: { schemas: Record<string, Schema> } };
const schemas = bundle.components.schemas;

describe('the second step of EVM-023 in the contract (SR-AUTH-07, SR-AUTH-08, SR-LOG-02)', () => {
  it('EVM-023 AC2 the code of the authenticator is exactly six ASCII digits and nothing else is accepted in the request', () => {
    expect(zLoginTotpRequestWritable.safeParse({ loginToken: TOKEN, code: '012345' }).success).toBe(true);
    for (const code of ['12345', '1234567', '12345a', ' 12345', '１２３４５６', 123456, null])
      expect(zLoginTotpRequestWritable.safeParse({ loginToken: TOKEN, code }).success, String(code)).toBe(false);
    expect(zConfirmTotpRequestWritable.safeParse({ code: '000000' }).success).toBe(true);
    expect(zConfirmTotpRequestWritable.safeParse({ code: '00000' }).success).toBe(false);
  });

  it('EVM-023 AC5 a recovery code input is bounded (a longer text is no code) and the request needs the login token', () => {
    expect(zLoginRecoveryCodeRequestWritable.safeParse({ loginToken: TOKEN, code: 'ABCDE-FGHIJ KLMNO-PQRST' }).success).toBe(true);
    expect(zLoginRecoveryCodeRequestWritable.safeParse({ loginToken: TOKEN, code: 'A'.repeat(65) }).success).toBe(false);
    expect(zLoginRecoveryCodeRequestWritable.safeParse({ loginToken: TOKEN, code: '' }).success).toBe(false);
    expect(zLoginRecoveryCodeRequestWritable.safeParse({ code: 'ABCDEFGHIJKLMNOPQRST' }).success).toBe(false);
  });

  it('EVM-023 AC7 a step-up is a passkey assertion or a TOTP code, nothing else (a recovery code is not accepted)', () => {
    expect(zStepUpRequestWritable.safeParse({ credential: ASSERTION }).success).toBe(true);
    expect(zStepUpRequestWritable.safeParse({ method: 'totp', code: '123456' }).success).toBe(true);
    expect(zStepUpRequestWritable.safeParse({ method: 'recovery_code', code: 'ABCDEFGHIJKLMNOPQRST' }).success).toBe(false);
    expect(zStepUpRequestWritable.safeParse({ method: 'totp', code: '12345' }).success).toBe(false);
    expect(zStepUpRequestWritable.safeParse({ code: '123456' }).success).toBe(false);
  });

  it('EVM-023 AC2 AC5 the methods of the second step are passkey, totp and recovery_code', () => {
    const base = { state: 'second_step', loginToken: TOKEN };
    for (const methods of [['passkey'], ['totp', 'recovery_code'], ['passkey', 'totp', 'recovery_code']])
      expect(zLoginSecondStep.safeParse({ ...base, methods }).success, methods.join()).toBe(true);
    expect(zLoginSecondStep.safeParse({ ...base, methods: ['sms'] }).success).toBe(false);
  });

  it('EVM-023 AC1 the setup answer is a base32 secret of 160 bits and an otpauth address', () => {
    const answer = { secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', otpauthUri: 'otpauth://totp/EVia%20Manager:a@evia.invalid?secret=X' };
    expect(zTotpSetup.safeParse(answer).success).toBe(true);
    expect(zTotpSetup.safeParse({ ...answer, secret: 'ABC' }).success).toBe(false);
    expect(zTotpSetup.safeParse({ ...answer, secret: 'abcdefghijklmnopqrstuvwxyz234567' }).success).toBe(false);
  });

  it('EVM-023 AC4 recovery codes are exactly ten of 20 base32 characters', () => {
    const codes = Array.from({ length: 10 }, (_, index) => `${'ABCDEFGHIJ'.charAt(index)}${'A'.repeat(19)}`);
    expect(zRecoveryCodes.safeParse({ codes }).success).toBe(true);
    expect(zRecoveryCodes.safeParse({ codes: codes.slice(1) }).success).toBe(false);
    expect(zRecoveryCodes.safeParse({ codes: [...codes, 'A'.repeat(20)] }).success).toBe(false);
    expect(zRecoveryCodes.safeParse({ codes: [...codes.slice(1), 'a'.repeat(20)] }).success).toBe(false);
  });

  it('EVM-023 AC1 AC4 the secrets are marked by direction: codes of the request writeOnly, the secret, the address and the new codes readOnly (SR-LOG-02)', () => {
    expect(schemas['TotpCode']).toMatchObject({ writeOnly: true });
    expect(schemas['RecoveryCodeInput']).toMatchObject({ writeOnly: true });
    expect(schemas['TotpSetup']?.properties?.['secret']?.readOnly).toBe(true);
    expect(schemas['TotpSetup']?.properties?.['otpauthUri']?.readOnly).toBe(true);
    expect(schemas['RecoveryCodes']?.properties?.['codes']?.readOnly).toBe(true);
  });

  it('EVM-023 AC8 the endpoints and their authorization: the sign-in codes are public, the setup belongs to the enrolment, the recovery codes need the mark of the full re-authentication or the window of the setup (EVM-028), every role may use them', () => {
    expect(AUTHZ_MANIFEST['loginTotp']?.authz).toEqual({ public: true });
    expect(AUTHZ_MANIFEST['loginRecoveryCode']?.authz).toEqual({ public: true });
    // the Administrator has no code of the app in the panel (P1): the manifest itself leaves them out, so the guard answers 403 before any handler
    for (const id of ['startTotpEnrolment', 'confirmTotp'])
      expect(AUTHZ_MANIFEST[id]?.authz, id).toMatchObject({
        roles: ['editor', 'read_only'],
        channels: ['web'],
        allowDuringMfaEnrollment: true,
      });
    // EVM-028: the window of the step-up is no longer the guard's — the use case asks for the mark of the re-authentication or, for the third step of a setup, for the window
    expect(AUTHZ_MANIFEST['generateRecoveryCodes']?.authz).toMatchObject({ channels: ['web'], audit: true });
    expect(AUTHZ_MANIFEST['generateRecoveryCodes']?.authz.stepUp).toBeUndefined();
    expect(AUTHZ_MANIFEST['generateRecoveryCodes']?.authz.allowDuringMfaEnrollment).toBeUndefined();
    expect(AUTHZ_MANIFEST['stepUp']?.authz.roles).toEqual(['administrator', 'editor', 'read_only']);
  });
});
