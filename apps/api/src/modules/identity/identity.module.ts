/**
 * Module `identity` (ADR-0001, ADR-0005): accounts, credentials, passkeys, one-time links, sign-in and sessions; owner of the
 * `identity` schema. Publishes its events through the platform event bus (audit subscribes) and never imports `audit`.
 * The slow and external capabilities sit behind ports; tests replace them with fakes (never with switches in the code).
 */
import { Module } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config.ts';
import { APP_CONFIG } from '../../platform/tokens.ts';
import { ActivationService } from './application/activation.service.ts';
import { AdministratorBootstrap } from './application/administrator-bootstrap.service.ts';
import { LoginFailures } from './application/login-failures.ts';
import { LoginPasskeyService } from './application/login-passkey.service.ts';
import { LoginService } from './application/login.service.ts';
import { PasskeyService } from './application/passkey.service.ts';
import { SessionService } from './application/session.service.ts';
import { AuthController } from './http/auth.controller.ts';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.ts';
import { BREACHED_PASSWORD_CHECK, PASSKEY_VERIFIER, PASSWORD_HASHER } from './infrastructure/ports.ts';
import { PwnedPasswordsCheck } from './infrastructure/pwned-passwords.ts';
import { SimpleWebAuthnPasskeys } from './infrastructure/simplewebauthn-passkeys.ts';

@Module({
  controllers: [AuthController],
  providers: [
    ActivationService,
    LoginFailures,
    LoginPasskeyService,
    LoginService,
    PasskeyService,
    SessionService,
    AdministratorBootstrap,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: BREACHED_PASSWORD_CHECK, useFactory: () => new PwnedPasswordsCheck() },
    {
      provide: PASSKEY_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SimpleWebAuthnPasskeys({ rpId: config.webauthn.rpId, rpName: config.webauthn.rpName, origin: config.panelOrigin }),
    },
  ],
  exports: [SessionService, AdministratorBootstrap],
})
export class IdentityModule {}
