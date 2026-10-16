/**
 * HTTP surface of the identity module (EVM-016, EVM-067, EVM-023): activation with a one-time link, the two steps of the sign-in
 * (the second with a passkey, a code of the authenticator app or a recovery code), the current session, its extension, logout, the passkey
 * and the code of the app of the account, and the recovery codes. Handlers contain no authorization — the global guard decides before they run (operation in
 * the manifest, CSRF, enrolment state, channel, role); here only input validation, the call and the response.
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  zCheckActivationLinkRequest,
  zConfirmTotpRequestWritable,
  zLoginRecoveryCodeRequestWritable,
  zLoginTotpRequestWritable,
  zCheckPasswordResetLinkRequest,
  zCompletePasswordResetRequestWritable,
  zRequestPasswordResetRequest,
  zLoginPasskeyOptionsRequest,
  zLoginRequestWritable,
  zRegisterPasskeyRequest,
  zSetActivationPasswordRequestWritable,
  zStepUpRequestWritable,
  zVerifyLoginPasskeyRequest,
} from '@evia/contracts/zod';
import type {
  ActivationLinkInfo,
  ActivationPasswordResult,
  CurrentSession,
  LoginResult,
  LoginSecondStep,
  PasswordResetLinkInfo,
  PasswordResetRequested,
  Passkey,
  RecoveryCodeSessionStarted,
  RecoveryCodes,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
  RegisterPasskeyRequest,
  SessionExpiry,
  SessionStarted,
  StepUpRequestWritable,
  StepUpResult,
  TotpSetup,
  VerifyLoginPasskeyRequest,
  LoginRecoveryCodeRequestWritable,
  LoginTotpRequestWritable,
} from '@evia/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { OperationId } from '../../../platform/http/operation-id.ts';
import { principalOf, type Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { webEventContext } from '../../../platform/http/request-context.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { ActivationService, type ClientInfo } from '../application/activation.service.ts';
import { LoginPasskeyService } from '../application/login-passkey.service.ts';
import { LoginRecoveryCodeService } from '../application/login-recovery-code.service.ts';
import { LoginTotpService } from '../application/login-totp.service.ts';
import { LoginService } from '../application/login.service.ts';
import { PasskeyService } from '../application/passkey.service.ts';
import { PasswordResetService } from '../application/password-reset.service.ts';
import { RecoveryCodeService } from '../application/recovery-code.service.ts';
import { SessionService } from '../application/session.service.ts';
import { StepUpService } from '../application/step-up.service.ts';
import { TotpEnrolmentService } from '../application/totp-enrolment.service.ts';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './session-cookie.ts';

const checkLinkBody = strictObjects(zCheckActivationLinkRequest);
const setPasswordBody = strictObjects(zSetActivationPasswordRequestWritable);
const requestResetBody = strictObjects(zRequestPasswordResetRequest);
const checkResetBody = strictObjects(zCheckPasswordResetLinkRequest);
const completeResetBody = strictObjects(zCompletePasswordResetRequestWritable);
const registerPasskeyBody = strictObjects(zRegisterPasskeyRequest);
const loginBody = strictObjects(zLoginRequestWritable);
const loginOptionsBody = strictObjects(zLoginPasskeyOptionsRequest);
const verifyLoginBody = strictObjects(zVerifyLoginPasskeyRequest);
const loginTotpBody = strictObjects(zLoginTotpRequestWritable);
const loginRecoveryCodeBody = strictObjects(zLoginRecoveryCodeRequestWritable);
const confirmTotpBody = strictObjects(zConfirmTotpRequestWritable);
/** A passkey credential or a TOTP code and nothing else: a recovery code (or any other field) is a 400 — decision 16. */
const stepUpBody = strictObjects(zStepUpRequestWritable);
/** `extendSession` takes no input: a body naming a session (or anything else) is refused, the session is the cookie's. */
const emptyBody = strictObjects(z.object({}));

/** What a handler of an authenticated operation can rely on: the guard has let a principal through. */
function requirePrincipal(request: Request): Principal {
  const principal = principalOf(request);
  if (principal === null) throw new ProblemException('unauthenticated');
  return principal;
}

/** The session token of the request's cookie when it carried exactly one — the session a sign-in replaces (rotation). */
const previousSessionToken = (request: Request): string | undefined => {
  const cookie = readSessionCookie(request.headers.cookie);
  return cookie.kind === 'token' ? cookie.token : undefined;
};

const clientOf = (request: Request, response: Response): ClientInfo => ({
  context: webEventContext(request, response),
  userAgent: request.get('user-agent'),
});

@Controller()
export class AuthController {
  readonly #activation: ActivationService;
  readonly #logins: LoginService;
  readonly #passkeyLogins: LoginPasskeyService;
  readonly #totpLogins: LoginTotpService;
  readonly #recoveryCodeLogins: LoginRecoveryCodeService;
  readonly #passkeys: PasskeyService;
  readonly #totpEnrolment: TotpEnrolmentService;
  readonly #recoveryCodes: RecoveryCodeService;
  readonly #passwordResets: PasswordResetService;
  readonly #sessions: SessionService;
  readonly #stepUps: StepUpService;

  constructor(
    @Inject(ActivationService) activation: ActivationService,
    @Inject(LoginService) logins: LoginService,
    @Inject(LoginPasskeyService) passkeyLogins: LoginPasskeyService,
    @Inject(LoginTotpService) totpLogins: LoginTotpService,
    @Inject(LoginRecoveryCodeService) recoveryCodeLogins: LoginRecoveryCodeService,
    @Inject(PasskeyService) passkeys: PasskeyService,
    @Inject(TotpEnrolmentService) totpEnrolment: TotpEnrolmentService,
    @Inject(RecoveryCodeService) recoveryCodes: RecoveryCodeService,
    @Inject(PasswordResetService) passwordResets: PasswordResetService,
    @Inject(SessionService) sessions: SessionService,
    @Inject(StepUpService) stepUps: StepUpService,
  ) {
    this.#activation = activation;
    this.#logins = logins;
    this.#passkeyLogins = passkeyLogins;
    this.#totpLogins = totpLogins;
    this.#recoveryCodeLogins = recoveryCodeLogins;
    this.#passkeys = passkeys;
    this.#totpEnrolment = totpEnrolment;
    this.#recoveryCodes = recoveryCodes;
    this.#passwordResets = passwordResets;
    this.#sessions = sessions;
    this.#stepUps = stepUps;
  }

  @Post('/api/v1/auth/activation/check')
  @OperationId('checkActivationLink')
  @HttpCode(200)
  checkActivationLink(@Body() body: unknown): Promise<ActivationLinkInfo> {
    const { token } = parseInput(checkLinkBody, body) as { token: string };
    return this.#activation.checkLink(token);
  }

  @Post('/api/v1/auth/activation/password')
  @OperationId('setActivationPassword')
  @HttpCode(200)
  async setActivationPassword(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ActivationPasswordResult> {
    const { token, password } = parseInput(setPasswordBody, body) as { token: string; password: string };
    const session = await this.#activation.setPassword(token, password, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { csrfToken: session.csrfToken };
  }

  /** Always 202 with an empty object (AC1): what the service did is not the answer. */
  @Post('/api/v1/auth/password-reset/request')
  @OperationId('requestPasswordReset')
  @HttpCode(202)
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PasswordResetRequested> {
    const { email } = parseInput(requestResetBody, body) as { email: string };
    await this.#passwordResets.request(email, clientOf(request, response));
    return {};
  }

  @Post('/api/v1/auth/password-reset/check')
  @OperationId('checkPasswordResetLink')
  @HttpCode(200)
  checkPasswordResetLink(@Body() body: unknown): Promise<PasswordResetLinkInfo> {
    const { token } = parseInput(checkResetBody, body) as { token: string };
    return this.#passwordResets.check(token);
  }

  /** No cookie and no session: the answer is the first step of a sign-in (AC4). */
  @Post('/api/v1/auth/password-reset/complete')
  @OperationId('completePasswordReset')
  @HttpCode(200)
  completePasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginSecondStep> {
    const { token, password } = parseInput(completeResetBody, body) as { token: string; password: string };
    return this.#passwordResets.complete(token, password, clientOf(request, response));
  }

  @Post('/api/v1/auth/login')
  @OperationId('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<LoginResult> {
    const { email, password } = parseInput(loginBody, body) as { email: string; password: string };
    const outcome = await this.#logins.login(email, password, clientOf(request, response), previousSessionToken(request));
    if (outcome.kind === 'second_step') return { state: 'second_step', loginToken: outcome.loginToken, methods: [...outcome.methods] };
    response.set('Set-Cookie', sessionCookie(outcome.session.sessionToken, outcome.session.maxAgeSeconds));
    return { state: 'mfa_enrollment', csrfToken: outcome.session.csrfToken };
  }

  @Post('/api/v1/auth/login/passkey/options')
  @OperationId('getLoginPasskeyOptions')
  @HttpCode(200)
  getLoginPasskeyOptions(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PasskeyAuthenticationOptions> {
    const { loginToken } = parseInput(loginOptionsBody, body) as { loginToken: string };
    return this.#passkeyLogins.options(loginToken, clientOf(request, response));
  }

  @Post('/api/v1/auth/login/passkey')
  @OperationId('verifyLoginPasskey')
  @HttpCode(200)
  async verifyLoginPasskey(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStarted> {
    const input = parseInput(verifyLoginBody, body) as VerifyLoginPasskeyRequest;
    const session = await this.#passkeyLogins.verify(input, clientOf(request, response), previousSessionToken(request));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { state: 'active', csrfToken: session.csrfToken };
  }

  @Post('/api/v1/auth/login/totp')
  @OperationId('loginTotp')
  @HttpCode(200)
  async loginTotp(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<SessionStarted> {
    const input = parseInput(loginTotpBody, body) as LoginTotpRequestWritable;
    const session = await this.#totpLogins.verify(input, clientOf(request, response), previousSessionToken(request));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { state: 'active', csrfToken: session.csrfToken };
  }

  @Post('/api/v1/auth/login/recovery-code')
  @OperationId('loginRecoveryCode')
  @HttpCode(200)
  async loginRecoveryCode(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RecoveryCodeSessionStarted> {
    const input = parseInput(loginRecoveryCodeBody, body) as LoginRecoveryCodeRequestWritable;
    const { session, remainingCodes } = await this.#recoveryCodeLogins.verify(
      input,
      clientOf(request, response),
      previousSessionToken(request),
    );
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { state: 'active', csrfToken: session.csrfToken, remainingCodes };
  }

  @Get('/api/v1/auth/session')
  @OperationId('getCurrentSession')
  getCurrentSession(@Req() request: Request): Promise<CurrentSession> {
    return this.#sessions.current(requirePrincipal(request));
  }

  @Post('/api/v1/auth/session/extend')
  @OperationId('extendSession')
  @HttpCode(200)
  extendSession(@Body() body: unknown, @Req() request: Request): Promise<SessionExpiry> {
    parseInput(emptyBody, body ?? {});
    return this.#sessions.extend(requirePrincipal(request));
  }

  @Post('/api/v1/auth/logout')
  @OperationId('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.#sessions.logout(requirePrincipal(request), webEventContext(request, response));
    response.set('Clear-Site-Data', '"cache", "storage"');
    response.set('Set-Cookie', clearedSessionCookie());
  }

  @Post('/api/v1/auth/step-up/options')
  @OperationId('getStepUpPasskeyOptions')
  @HttpCode(200)
  getStepUpPasskeyOptions(@Body() body: unknown, @Req() request: Request): Promise<PasskeyAuthenticationOptions> {
    parseInput(emptyBody, body ?? {});
    return this.#stepUps.options(requirePrincipal(request));
  }

  @Post('/api/v1/auth/step-up')
  @OperationId('stepUp')
  @HttpCode(200)
  async stepUp(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<StepUpResult> {
    const input = parseInput(stepUpBody, body) as StepUpRequestWritable;
    const session = await this.#stepUps.verify(requirePrincipal(request), input, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { csrfToken: session.csrfToken };
  }

  @Post('/api/v1/account/passkeys/registration-options')
  @OperationId('getPasskeyRegistrationOptions')
  @HttpCode(200)
  getPasskeyRegistrationOptions(@Req() request: Request): Promise<PasskeyRegistrationOptions> {
    return this.#passkeys.registrationOptions(requirePrincipal(request)) as Promise<PasskeyRegistrationOptions>;
  }

  @Post('/api/v1/account/passkeys')
  @OperationId('registerPasskey')
  @HttpCode(201)
  async registerPasskey(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Passkey> {
    const input = parseInput(registerPasskeyBody, body) as RegisterPasskeyRequest;
    const result = await this.#passkeys.register(requirePrincipal(request), input, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(result.sessionToken, result.maxAgeSeconds));
    return result.passkey;
  }

  @Post('/api/v1/account/totp/setup')
  @OperationId('setupTotp')
  @HttpCode(200)
  setupTotp(@Body() body: unknown, @Req() request: Request): Promise<TotpSetup> {
    parseInput(emptyBody, body ?? {});
    return this.#totpEnrolment.setup(requirePrincipal(request));
  }

  @Post('/api/v1/account/totp/confirm')
  @OperationId('confirmTotp')
  @HttpCode(200)
  async confirmTotp(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionStarted> {
    const { code } = parseInput(confirmTotpBody, body) as { code: string };
    const session = await this.#totpEnrolment.confirm(requirePrincipal(request), code, clientOf(request, response));
    response.set('Set-Cookie', sessionCookie(session.sessionToken, session.maxAgeSeconds));
    return { state: 'active', csrfToken: session.csrfToken };
  }

  @Post('/api/v1/account/recovery-codes')
  @OperationId('generateRecoveryCodes')
  @HttpCode(200)
  generateRecoveryCodes(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RecoveryCodes> {
    parseInput(emptyBody, body ?? {});
    return this.#recoveryCodes.generate(requirePrincipal(request), clientOf(request, response));
  }
}
