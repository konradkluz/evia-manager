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
import { InvitationEmailComposer } from './application/invitation-email.composer.ts';
import { InvitationService } from './application/invitation.service.ts';
import { ListUsersService } from './application/list-users.service.ts';
import { LoginFailures } from './application/login-failures.ts';
import { LoginPasskeyService } from './application/login-passkey.service.ts';
import { LoginRecoveryCodeService } from './application/login-recovery-code.service.ts';
import { LoginTotpService } from './application/login-totp.service.ts';
import { MfaEmailComposer } from './application/mfa-email.composer.ts';
import { LoginService } from './application/login.service.ts';
import { PasskeyService } from './application/passkey.service.ts';
import { PasswordEmailComposer } from './application/password-email.composer.ts';
import { PasswordResetService } from './application/password-reset.service.ts';
import { PasswordSetting } from './application/password-setting.ts';
import { RecoveryCodeService } from './application/recovery-code.service.ts';
import { SessionService } from './application/session.service.ts';
import { StepUpService } from './application/step-up.service.ts';
import { TotpEnrolmentService } from './application/totp-enrolment.service.ts';
import { UserAccessService } from './application/user-access.service.ts';
import { UserDirectory } from './application/user-directory.ts';
import { AuthController } from './http/auth.controller.ts';
import { UsersController } from './http/users.controller.ts';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.ts';
import { BREACHED_PASSWORD_CHECK, PASSKEY_VERIFIER, PASSWORD_HASHER } from './infrastructure/ports.ts';
import { PwnedPasswordsCheck } from './infrastructure/pwned-passwords.ts';
import { SimpleWebAuthnPasskeys } from './infrastructure/simplewebauthn-passkeys.ts';
import { OtpauthTotpEngine, TOTP_ENGINE } from './infrastructure/totp-engine.ts';

@Module({
  controllers: [AuthController, UsersController],
  providers: [
    ActivationService,
    LoginFailures,
    LoginPasskeyService,
    LoginRecoveryCodeService,
    LoginService,
    LoginTotpService,
    MfaEmailComposer,
    PasskeyService,
    PasswordEmailComposer,
    PasswordResetService,
    PasswordSetting,
    RecoveryCodeService,
    SessionService,
    StepUpService,
    TotpEnrolmentService,
    UserAccessService,
    UserDirectory,
    AdministratorBootstrap,
    InvitationEmailComposer,
    InvitationService,
    ListUsersService,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOTP_ENGINE, useClass: OtpauthTotpEngine },
    { provide: BREACHED_PASSWORD_CHECK, useFactory: () => new PwnedPasswordsCheck() },
    {
      provide: PASSKEY_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SimpleWebAuthnPasskeys({ rpId: config.webauthn.rpId, rpName: config.webauthn.rpName, origin: config.panelOrigin }),
    },
  ],
  exports: [SessionService, AdministratorBootstrap, UserDirectory, InvitationEmailComposer, PasswordEmailComposer, MfaEmailComposer],
})
export class IdentityModule {}
