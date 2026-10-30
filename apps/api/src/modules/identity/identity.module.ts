/**
 * Module `identity` (ADR-0001, ADR-0005): accounts, credentials, passkeys, one-time links, sign-in and sessions; owner of the
 * `identity` schema. Publishes its events through the platform event bus (audit subscribes) and never imports `audit`.
 * The slow and external capabilities sit behind ports; tests replace them with fakes (never with switches in the code).
 */
import { Module } from '@nestjs/common';
import type { AppConfig } from '../../platform/config/config.ts';
import { APP_CONFIG } from '../../platform/tokens.ts';
import { AccountService } from './application/account.service.ts';
import { AccountSessionsService } from './application/account-sessions.service.ts';
import { ActivationService } from './application/activation.service.ts';
import { DeviceWipeService } from './application/device-wipe.service.ts';
import { MobileLoginService } from './application/mobile-login.service.ts';
import { MobileLoginTotpService } from './application/mobile-login-totp.service.ts';
import { MobileRefreshService } from './application/mobile-refresh.service.ts';
import { MobileSessionService } from './application/mobile-session.service.ts';
import { AdministratorBootstrap } from './application/administrator-bootstrap.service.ts';
import { InvitationEmailComposer } from './application/invitation-email.composer.ts';
import { InvitationService } from './application/invitation.service.ts';
import { ListUsersService } from './application/list-users.service.ts';
import { BrowserRegister } from './application/browser-register.ts';
import { LoginAttemptGate } from './application/login-attempt.ts';
import { LoginFailures } from './application/login-failures.ts';
import { LoginPasskeyService } from './application/login-passkey.service.ts';
import { LoginRecoveryCodeService } from './application/login-recovery-code.service.ts';
import { LoginSecurityEmailComposer } from './application/login-security-email.composer.ts';
import { LoginThrottle } from './application/login-throttle.ts';
import { LoginTotpService } from './application/login-totp.service.ts';
import { MfaEmailComposer } from './application/mfa-email.composer.ts';
import { LoginService } from './application/login.service.ts';
import { PasskeyService } from './application/passkey.service.ts';
import { PasswordEmailComposer } from './application/password-email.composer.ts';
import { PasswordResetService } from './application/password-reset.service.ts';
import { PasswordSetting } from './application/password-setting.ts';
import { PasswordChangeService } from './application/password-change.service.ts';
import { PurgeLoginSecurityJob } from './application/purge-login-security.job.ts';
import { AdministratorDirectory } from './application/administrator-directory.ts';
import { PurgeSessionsJob } from './application/purge-sessions.job.ts';
import { ReauthenticationService } from './application/reauthentication.service.ts';
import { RecoveryCodeService } from './application/recovery-code.service.ts';
import { SecondStepManagementService } from './application/second-step-management.service.ts';
import { SecondStepProof } from './application/second-step-proof.ts';
import { SessionService } from './application/session.service.ts';
import { StepUpService } from './application/step-up.service.ts';
import { TotpEnrolmentService } from './application/totp-enrolment.service.ts';
import { UserAccessService } from './application/user-access.service.ts';
import { UserDirectory } from './application/user-directory.ts';
import { VerificationGate } from './application/verification-gate.ts';
import { AccountController } from './http/account.controller.ts';
import { AuthController } from './http/auth.controller.ts';
import { MobileController } from './http/mobile.controller.ts';
import { UsersController } from './http/users.controller.ts';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.ts';
import { BREACHED_PASSWORD_CHECK, PASSKEY_VERIFIER, PASSWORD_HASHER } from './infrastructure/ports.ts';
import { PwnedPasswordsCheck } from './infrastructure/pwned-passwords.ts';
import { SimpleWebAuthnPasskeys } from './infrastructure/simplewebauthn-passkeys.ts';
import { OtpauthTotpEngine, TOTP_ENGINE } from './infrastructure/totp-engine.ts';

import { UserSyncSourceService } from './infrastructure/sync-source.ts';
import { USER_SYNC_SOURCE } from './system-ports.ts';

@Module({
  controllers: [AuthController, AccountController, UsersController, MobileController],
  providers: [
    AccountService,
    AccountSessionsService,
    DeviceWipeService,
    MobileLoginService,
    MobileLoginTotpService,
    MobileRefreshService,
    MobileSessionService,
    ActivationService,
    BrowserRegister,
    LoginAttemptGate,
    LoginFailures,
    LoginSecurityEmailComposer,
    LoginThrottle,
    PurgeLoginSecurityJob,
    PurgeSessionsJob,
    AdministratorDirectory,
    LoginPasskeyService,
    LoginRecoveryCodeService,
    LoginService,
    LoginTotpService,
    MfaEmailComposer,
    PasskeyService,
    PasswordChangeService,
    PasswordEmailComposer,
    PasswordResetService,
    PasswordSetting,
    ReauthenticationService,
    RecoveryCodeService,
    SecondStepManagementService,
    SecondStepProof,
    SessionService,
    StepUpService,
    TotpEnrolmentService,
    UserAccessService,
    UserDirectory,
    VerificationGate,
    AdministratorBootstrap,
    InvitationEmailComposer,
    InvitationService,
    ListUsersService,
    { provide: USER_SYNC_SOURCE, useClass: UserSyncSourceService },
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
  exports: [
    SessionService,
    MobileSessionService,
    AdministratorBootstrap,
    UserDirectory,
    InvitationEmailComposer,
    PasswordEmailComposer,
    MfaEmailComposer,
    LoginSecurityEmailComposer,
    PurgeLoginSecurityJob,
    PurgeSessionsJob,
    AdministratorDirectory,
    USER_SYNC_SOURCE,
  ],
})
export class IdentityModule {}
